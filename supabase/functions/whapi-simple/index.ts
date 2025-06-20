
import { createClient } from 'jsr:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface RequestBody {
  userId: string
  action: 'connect' | 'status' | 'disconnect' | 'sync-groups' | 'send-message' | 'schedule-message' | 'get-messages'
  data?: any
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    console.log('🚀 WHAPI Simple - Request received')
    
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const whapiPartnerToken = Deno.env.get('WHAPI_PARTNER_TOKEN')!
    
    const { userId, action, data } = await req.json() as RequestBody
    
    if (!userId) {
      return new Response(
        JSON.stringify({ error: 'User ID required' }),
        { status: 400, headers: corsHeaders }
      )
    }

    console.log(`📱 Action: ${action} for user: ${userId}`)
    
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    // Get user profile
    const { data: profile } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .single()

    if (!profile) {
      // Create profile if it doesn't exist
      await supabase
        .from('profiles')
        .insert({
          id: userId,
          payment_plan: 'trial',
          trial_expires_at: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
          instance_status: 'disconnected'
        })
    }

    // Check trial status for non-basic actions
    if (action !== 'connect' && action !== 'status' && action !== 'disconnect') {
      const now = new Date()
      const trialExpired = profile?.trial_expires_at && new Date(profile.trial_expires_at) < now
      const isPaid = profile?.payment_plan === 'monthly' || profile?.payment_plan === 'yearly'
      
      if (trialExpired && !isPaid) {
        return new Response(
          JSON.stringify({ 
            error: 'Trial expired',
            message: 'Please upgrade to continue using WhatsApp features'
          }),
          { status: 403, headers: corsHeaders }
        )
      }
    }

    // Handle different actions
    switch (action) {
      case 'status':
        return await handleStatus(supabase, userId)
      
      case 'disconnect':
        return await handleDisconnect(supabase, userId, whapiPartnerToken)
      
      case 'sync-groups':
        return await handleSyncGroups(supabase, userId)
      
      case 'send-message':
        return await handleSendMessage(supabase, userId, data)
      
      case 'schedule-message':
        return await handleScheduleMessage(supabase, userId, data)
      
      case 'get-messages':
        return await handleGetMessages(supabase, userId, data)
      
      default: // 'connect'
        return await handleConnect(supabase, userId, whapiPartnerToken)
    }

  } catch (error) {
    console.error('💥 Error:', error)
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: corsHeaders }
    )
  }
})

// === CONNECT / QR CODE ===
async function handleConnect(supabase: any, userId: string, partnerToken: string) {
  console.log('🔗 Handling connect for user:', userId)
  
  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .single()

  // Check if already has a working token
  if (profile?.whapi_token) {
    console.log('🔍 Checking existing token...')
    
    const healthCheck = await fetch('https://gate.whapi.cloud/health', {
      headers: { 'Authorization': `Bearer ${profile.whapi_token}` }
    })

    if (healthCheck.ok) {
      const health = await healthCheck.json()
      console.log('📊 Health status:', health.status)
      
      if (health.status === 'authenticated' || health.status === 'ready') {
        await supabase
          .from('profiles')
          .update({ 
            instance_status: 'connected',
            updated_at: new Date().toISOString()
          })
          .eq('id', userId)

        return new Response(
          JSON.stringify({ 
            success: true,
            already_connected: true,
            message: 'WhatsApp already connected!'
          }),
          { status: 200, headers: corsHeaders }
        )
      }
      
      if (health.status === 'qr' || health.status === 'unauthorized') {
        console.log('📱 Getting QR code...')
        
        const qrResponse = await fetch('https://gate.whapi.cloud/qr', {
          headers: { 
            'Authorization': `Bearer ${profile.whapi_token}`,
            'Accept': 'application/json'
          }
        })

        if (qrResponse.ok) {
          const qrData = await qrResponse.json()
          let qrCode = qrData.qr || qrData.qrCode || qrData.image || qrData.base64
          
          if (qrCode) {
            if (!qrCode.startsWith('data:image/')) {
              qrCode = `data:image/png;base64,${qrCode}`
            }

            await supabase
              .from('profiles')
              .update({ 
                instance_status: 'unauthorized',
                updated_at: new Date().toISOString()
              })
              .eq('id', userId)

            return new Response(
              JSON.stringify({ 
                success: true,
                qr_code: qrCode,
                message: 'Scan QR code with WhatsApp'
              }),
              { status: 200, headers: corsHeaders }
            )
          }
        }
      }
    }
  }

  // Create new instance
  console.log('🆕 Creating new instance...')
  
  // Clean up old instance if exists
  if (profile?.instance_id) {
    try {
      await fetch(`https://manager.whapi.cloud/channels/${profile.instance_id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${partnerToken}` }
      })
      console.log('🗑️ Cleaned up old instance')
    } catch (e) {
      console.log('Cleanup error (continuing):', e)
    }
  }

  // Get or use project ID
  let projectId = Deno.env.get('WHAPI_PROJECT_ID')
  
  if (!projectId) {
    const projectsRes = await fetch('https://manager.whapi.cloud/projects', {
      headers: { 'Authorization': `Bearer ${partnerToken}` }
    })
    
    if (projectsRes.ok) {
      const projects = await projectsRes.json()
      if (projects?.length > 0) {
        projectId = projects[0].id
      }
    }
  }

  if (!projectId) {
    throw new Error('No WHAPI project available')
  }

  // Create channel
  const createRes = await fetch('https://manager.whapi.cloud/channels', {
    method: 'PUT',
    headers: {
      'Authorization': `Bearer ${partnerToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      name: `reecher_${userId.substring(0, 8)}`,
      projectId: projectId
    })
  })

  if (!createRes.ok) {
    const error = await createRes.text()
    throw new Error(`Failed to create channel: ${error}`)
  }

  const channel = await createRes.json()
  console.log('✅ Created channel:', channel.id)

  // Setup webhook
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  try {
    await fetch('https://gate.whapi.cloud/settings', {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${channel.token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        webhooks: [{
          url: `${supabaseUrl}/functions/v1/whapi-webhook-simple`,
          events: ['users', 'channel'],
          mode: 'body'
        }]
      })
    })
    console.log('🔗 Webhook configured')
  } catch (e) {
    console.log('Webhook setup warning:', e)
  }

  // Save to database
  await supabase
    .from('profiles')
    .update({
      instance_id: channel.id,
      whapi_token: channel.token,
      instance_status: 'initializing',
      updated_at: new Date().toISOString()
    })
    .eq('id', userId)

  console.log('💾 Saved to database')

  // Wait for initialization and get QR
  await new Promise(resolve => setTimeout(resolve, 3000))

  let attempts = 0
  while (attempts < 8) {
    const healthCheck = await fetch('https://gate.whapi.cloud/health', {
      headers: { 'Authorization': `Bearer ${channel.token}` }
    })

    if (healthCheck.ok) {
      const health = await healthCheck.json()
      console.log(`Attempt ${attempts + 1}: ${health.status}`)
      
      if (health.status === 'qr' || health.status === 'unauthorized') {
        const qrResponse = await fetch('https://gate.whapi.cloud/qr', {
          headers: { 
            'Authorization': `Bearer ${channel.token}`,
            'Accept': 'application/json'
          }
        })

        if (qrResponse.ok) {
          const qrData = await qrResponse.json()
          let qrCode = qrData.qr || qrData.qrCode || qrData.image || qrData.base64
          
          if (qrCode) {
            if (!qrCode.startsWith('data:image/')) {
              qrCode = `data:image/png;base64,${qrCode}`
            }

            await supabase
              .from('profiles')
              .update({ 
                instance_status: 'unauthorized',
                updated_at: new Date().toISOString()
              })
              .eq('id', userId)

            return new Response(
              JSON.stringify({ 
                success: true,
                qr_code: qrCode,
                message: 'New instance created! Scan QR code with WhatsApp'
              }),
              { status: 200, headers: corsHeaders }
            )
          }
        }
      }
    }

    attempts++
    await new Promise(resolve => setTimeout(resolve, 2000))
  }

  return new Response(
    JSON.stringify({ 
      success: true,
      message: 'Instance created. Please try getting QR code in a moment.',
      instance_id: channel.id
    }),
    { status: 200, headers: corsHeaders }
  )
}

// === STATUS CHECK ===
async function handleStatus(supabase: any, userId: string) {
  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .single()

  if (!profile?.whapi_token) {
    return new Response(
      JSON.stringify({ 
        connected: false, 
        status: 'no_instance',
        message: 'No WhatsApp instance found'
      }),
      { status: 200, headers: corsHeaders }
    )
  }

  const healthCheck = await fetch('https://gate.whapi.cloud/health', {
    headers: { 'Authorization': `Bearer ${profile.whapi_token}` }
  })

  if (!healthCheck.ok) {
    return new Response(
      JSON.stringify({ 
        connected: false, 
        status: 'error',
        message: 'Failed to check status'
      }),
      { status: 200, headers: corsHeaders }
    )
  }

  const health = await healthCheck.json()
  const connected = health.status === 'authenticated' || health.status === 'ready'

  let newStatus = 'disconnected'
  if (connected) {
    newStatus = 'connected'
  } else if (health.status === 'qr' || health.status === 'unauthorized') {
    newStatus = 'unauthorized'
  }
  
  if (newStatus !== profile.instance_status) {
    await supabase
      .from('profiles')
      .update({ 
        instance_status: newStatus,
        updated_at: new Date().toISOString()
      })
      .eq('id', userId)
  }

  // Check trial status
  const now = new Date()
  const trialExpired = profile.trial_expires_at && new Date(profile.trial_expires_at) < now
  const isPaid = profile.payment_plan === 'monthly' || profile.payment_plan === 'yearly'

  return new Response(
    JSON.stringify({ 
      connected,
      status: health.status,
      message: connected ? 'WhatsApp connected' : 'WhatsApp not connected',
      trial_expired: trialExpired && !isPaid,
      trial_expires_at: profile.trial_expires_at,
      payment_plan: profile.payment_plan
    }),
    { status: 200, headers: corsHeaders }
  )
}

// === DISCONNECT ===
async function handleDisconnect(supabase: any, userId: string, partnerToken: string) {
  const { data: profile } = await supabase
    .from('profiles')
    .select('instance_id')
    .eq('id', userId)
    .single()

  if (profile?.instance_id) {
    try {
      await fetch(`https://manager.whapi.cloud/channels/${profile.instance_id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${partnerToken}` }
      })
    } catch (e) {
      console.log('WHAPI deletion error:', e)
    }
  }

  await supabase
    .from('profiles')
    .update({
      instance_id: null,
      whapi_token: null,
      instance_status: 'disconnected',
      updated_at: new Date().toISOString()
    })
    .eq('id', userId)

  return new Response(
    JSON.stringify({ 
      success: true,
      message: 'WhatsApp disconnected'
    }),
    { status: 200, headers: corsHeaders }
  )
}

// === SYNC GROUPS ===
async function handleSyncGroups(supabase: any, userId: string) {
  const { data: profile } = await supabase
    .from('profiles')
    .select('whapi_token, instance_status')
    .eq('id', userId)
    .single()

  if (!profile?.whapi_token || profile.instance_status !== 'connected') {
    return new Response(
      JSON.stringify({ 
        error: 'WhatsApp not connected',
        message: 'Please connect WhatsApp first'
      }),
      { status: 400, headers: corsHeaders }
    )
  }

  const groupsRes = await fetch('https://gate.whapi.cloud/groups', {
    headers: { 'Authorization': `Bearer ${profile.whapi_token}` }
  })

  if (!groupsRes.ok) {
    return new Response(
      JSON.stringify({ error: 'Failed to fetch groups from WHAPI' }),
      { status: 400, headers: corsHeaders }
    )
  }

  const groupsData = await groupsRes.json()
  const groups = groupsData.groups || []
  
  console.log(`Found ${groups.length} groups`)

  // Clear existing groups
  await supabase
    .from('whatsapp_groups')
    .delete()
    .eq('user_id', userId)

  // Insert new groups
  if (groups.length > 0) {
    const groupsToInsert = groups.map((group: any) => ({
      user_id: userId,
      group_id: group.id,
      name: group.name || group.subject || 'Unknown Group',
      description: group.description || null,
      participants_count: group.participants?.length || group.size || 0,
      is_admin: group.isAdmin || group.is_admin || false,
      avatar_url: group.avatar || group.avatar_url || null
    }))

    const { error } = await supabase
      .from('whatsapp_groups')
      .insert(groupsToInsert)

    if (error) {
      throw new Error(`Failed to save groups: ${error.message}`)
    }
  }

  return new Response(
    JSON.stringify({ 
      success: true,
      groups_count: groups.length,
      message: `Synced ${groups.length} groups successfully`
    }),
    { status: 200, headers: corsHeaders }
  )
}

// === SEND MESSAGE ===
async function handleSendMessage(supabase: any, userId: string, data: any) {
  const { groupIds, message, mediaUrl, mediaType } = data

  if (!groupIds?.length || !message) {
    return new Response(
      JSON.stringify({ error: 'Group IDs and message are required' }),
      { status: 400, headers: corsHeaders }
    )
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('whapi_token, instance_status')
    .eq('id', userId)
    .single()

  if (!profile?.whapi_token || profile.instance_status !== 'connected') {
    return new Response(
      JSON.stringify({ error: 'WhatsApp not connected' }),
      { status: 400, headers: corsHeaders }
    )
  }

  const results = []
  let successCount = 0
  
  for (const groupId of groupIds) {
    try {
      const body: any = {
        to: groupId,
        body: message
      }

      if (mediaUrl) {
        body.media = {
          url: mediaUrl,
          type: mediaType || 'image'
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
        results.push({ groupId, success: true, messageId: result.id })
        successCount++
        
        // Save to history
        await supabase
          .from('message_history')
          .insert({
            user_id: userId,
            group_id: groupId,
            message,
            media_url: mediaUrl,
            status: 'sent',
            whapi_message_id: result.id
          })
      } else {
        const error = await sendRes.text()
        results.push({ groupId, success: false, error })
        
        // Save failed attempt
        await supabase
          .from('message_history')
          .insert({
            user_id: userId,
            group_id: groupId,
            message,
            media_url: mediaUrl,
            status: 'failed',
            error_message: error
          })
      }
    } catch (error) {
      results.push({ groupId, success: false, error: error.message })
    }
  }

  return new Response(
    JSON.stringify({ 
      success: successCount > 0,
      results,
      message: `Sent to ${successCount} of ${groupIds.length} groups`
    }),
    { status: 200, headers: corsHeaders }
  )
}

// === SCHEDULE MESSAGE ===
async function handleScheduleMessage(supabase: any, userId: string, data: any) {
  const { message, mediaUrl, mediaType, groupIds, tagIds, sendAt } = data

  if (!message || (!groupIds?.length && !tagIds?.length) || !sendAt) {
    return new Response(
      JSON.stringify({ error: 'Message, recipients, and send time are required' }),
      { status: 400, headers: corsHeaders }
    )
  }

  // If using tags, get the groups with those tags
  let finalGroupIds = groupIds || []
  
  if (tagIds?.length) {
    const { data: taggedGroups } = await supabase
      .from('group_tag_assignments')
      .select('group_id, whatsapp_groups!inner(group_id)')
      .in('tag_id', tagIds)
      .eq('whatsapp_groups.user_id', userId)

    if (taggedGroups) {
      const tagGroupIds = taggedGroups.map((tg: any) => tg.whatsapp_groups.group_id)
      finalGroupIds = [...new Set([...finalGroupIds, ...tagGroupIds])]
    }
  }

  const { data: scheduled, error } = await supabase
    .from('scheduled_messages')
    .insert({
      user_id: userId,
      message,
      media_url: mediaUrl,
      media_type: mediaType,
      group_ids: finalGroupIds,
      tag_ids: tagIds,
      send_at: sendAt
    })
    .select()
    .single()

  if (error) {
    return new Response(
      JSON.stringify({ error: 'Failed to schedule message' }),
      { status: 400, headers: corsHeaders }
    )
  }

  return new Response(
    JSON.stringify({ 
      success: true,
      scheduled_message: scheduled,
      message: `Message scheduled for ${new Date(sendAt).toLocaleString()}`
    }),
    { status: 200, headers: corsHeaders }
  )
}

// === GET MESSAGES ===
async function handleGetMessages(supabase: any, userId: string, data: any) {
  const { type = 'scheduled', limit = 20, offset = 0 } = data || {}

  if (type === 'scheduled') {
    const { data: messages } = await supabase
      .from('scheduled_messages')
      .select('*')
      .eq('user_id', userId)
      .order('send_at', { ascending: false })
      .range(offset, offset + limit - 1)

    return new Response(
      JSON.stringify({ 
        success: true,
        messages: messages || [],
        type: 'scheduled'
      }),
      { status: 200, headers: corsHeaders }
    )
  } else {
    const { data: messages } = await supabase
      .from('message_history')
      .select('*')
      .eq('user_id', userId)
      .order('sent_at', { ascending: false })
      .range(offset, offset + limit - 1)

    return new Response(
      JSON.stringify({ 
        success: true,
        messages: messages || [],
        type: 'history'
      }),
      { status: 200, headers: corsHeaders }
    )
  }
}
