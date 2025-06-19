
import { createClient } from 'jsr:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    console.log('📅 Running message scheduler...')

    // Get pending messages that are due
    const { data: pendingMessages } = await supabase
      .from('scheduled_messages')
      .select(`
        *,
        profiles!inner(whapi_token, instance_status)
      `)
      .eq('status', 'pending')
      .lte('send_at', new Date().toISOString())
      .limit(10)

    if (!pendingMessages || pendingMessages.length === 0) {
      console.log('No pending messages to send')
      return new Response(
        JSON.stringify({ message: 'No pending messages' }),
        { status: 200, headers: corsHeaders }
      )
    }

    console.log(`📤 Found ${pendingMessages.length} messages to send`)

    for (const message of pendingMessages) {
      try {
        // Update status to sending
        await supabase
          .from('scheduled_messages')
          .update({ status: 'sending' })
          .eq('id', message.id)

        const profile = message.profiles
        
        if (!profile.whapi_token || profile.instance_status !== 'connected') {
          console.log(`❌ User ${message.user_id} - WhatsApp not connected`)
          await supabase
            .from('scheduled_messages')
            .update({ 
              status: 'failed',
              updated_at: new Date().toISOString()
            })
            .eq('id', message.id)
          continue
        }

        let successCount = 0
        let failCount = 0

        // Send to each group
        for (const groupId of message.group_ids) {
          try {
            const body: any = {
              to: groupId,
              body: message.message
            }

            if (message.media_url) {
              body.media = {
                url: message.media_url,
                type: message.media_type || 'image'
              }
            }

            const sendRes = await fetch('https://gate.whapi.cloud/messages/text', {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${profile.whapi_token}`,
                'Content-Type': 'application/json'
              },
              body: JSON.stringify(body)
            })

            if (sendRes.ok) {
              const result = await sendRes.json()
              successCount++
              
              await supabase
                .from('message_history')
                .insert({
                  user_id: message.user_id,
                  scheduled_message_id: message.id,
                  group_id: groupId,
                  message: message.message,
                  media_url: message.media_url,
                  status: 'sent',
                  whapi_message_id: result.id
                })
            } else {
              failCount++
              const error = await sendRes.text()
              
              await supabase
                .from('message_history')
                .insert({
                  user_id: message.user_id,
                  scheduled_message_id: message.id,
                  group_id: groupId,
                  message: message.message,
                  media_url: message.media_url,
                  status: 'failed',
                  error_message: error
                })
            }
          } catch (error) {
            failCount++
            console.error(`❌ Error sending to ${groupId}:`, error)
          }
        }

        // Update message status
        const finalStatus = successCount > 0 ? 
          (failCount > 0 ? 'partial' : 'sent') : 'failed'
        
        await supabase
          .from('scheduled_messages')
          .update({ 
            status: finalStatus,
            updated_at: new Date().toISOString()
          })
          .eq('id', message.id)

        console.log(`✅ Message ${message.id}: ${successCount} sent, ${failCount} failed`)

      } catch (error) {
        console.error(`❌ Error processing message ${message.id}:`, error)
        await supabase
          .from('scheduled_messages')
          .update({ 
            status: 'failed',
            updated_at: new Date().toISOString()
          })
          .eq('id', message.id)
      }
    }

    return new Response(
      JSON.stringify({ 
        success: true,
        processed: pendingMessages.length,
        message: `Processed ${pendingMessages.length} scheduled messages`
      }),
      { status: 200, headers: corsHeaders }
    )

  } catch (error) {
    console.error('💥 Scheduler error:', error)
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: corsHeaders }
    )
  }
})
