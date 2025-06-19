
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

    const webhook = await req.json()
    console.log('📨 Simple Webhook received:', JSON.stringify(webhook, null, 2))

    // Handle channel status updates
    if (webhook.event === 'channel' && webhook.data?.id) {
      console.log(`🔄 Channel ${webhook.data.id} status: ${webhook.data.status}`)
      
      const { data: profiles } = await supabase
        .from('profiles')
        .select('id')
        .eq('instance_id', webhook.data.id)

      if (profiles && profiles.length > 0) {
        let newStatus = 'disconnected'
        
        if (webhook.data.status === 'authenticated' || webhook.data.status === 'ready') {
          newStatus = 'connected'
        } else if (webhook.data.status === 'qr' || webhook.data.status === 'unauthorized') {
          newStatus = 'unauthorized'
        }

        await supabase
          .from('profiles')
          .update({
            instance_status: newStatus,
            updated_at: new Date().toISOString()
          })
          .eq('instance_id', webhook.data.id)

        console.log(`✅ Updated instance ${webhook.data.id} status to: ${newStatus}`)
      }
    }

    // Handle user status updates
    if (webhook.event === 'users' && webhook.data?.status) {
      console.log(`👤 User status update: ${webhook.data.status}`)
      
      // This could be used to update connection status based on user events
      // For now, we'll just log it
    }

    return new Response(
      JSON.stringify({ success: true }),
      { status: 200, headers: corsHeaders }
    )

  } catch (error) {
    console.error('💥 Webhook error:', error)
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: corsHeaders }
    )
  }
})
