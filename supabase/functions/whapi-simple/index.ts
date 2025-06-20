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

// Helper for delays
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    console.log('🚀 WHAPI Simple - Request received')
    
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const whapiPartnerToken = Deno.env.get('WHAPI_PARTNER_TOKEN')!
    const whapiProjectId = Deno.env.get('WHAPI_PROJECT_ID')!
    
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

    // Handle different actions
    switch (action) {
      case 'status':
        return await handleStatus(supabase, userId, whapiPartnerToken)
      
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
        return await handleConnect(supabase, userId, whapiPartnerToken, whapiProjectId, supabaseUrl)
    }

  } catch (error) {
    console.error('💥 Error:', error)
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: corsHeaders }
    )
  }
})

// === CONNECT USING CORRECT WHAPI WORKFLOW ===
async function handleConnect(
  supabase: any, 
  userId: string, 
  partnerToken: string, 
  projectId: string,
  supabaseUrl: string
) {
  console.log('🔗 Starting WHAPI connection workflow for user:', userId)

  // Get current profile
  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .single()

  // STEP 1: Check existing channel via Manager API
  if (profile?.instance_id && profile?.whapi_token) {
    console.log('🔍 Found existing channel, checking via Manager API...')
    
    const channelCheckRes = await fetch(
      `https://manager.whapi.cloud/channels/${profile.instance_id}`,
      {
        headers: {
          'Authorization': `Bearer ${partnerToken}`,
          'Accept': 'application/json'
        }
      }
    )

    if (channelCheckRes.ok) {
      const channelInfo = await channelCheckRes.json()
      console.log('📋 Channel info from Manager API:', {
        id: channelInfo.id,
        status: channelInfo.status,
        hasToken: !!channelInfo.token
      })

      // Update status in database
      await supabase
        .from('profiles')
        .update({
          instance_status: channelInfo.status,
          updated_at: new Date().toISOString()
        })
        .eq('id', userId)

      // Check if already connected
      if (channelInfo.status === 'active' || 
          channelInfo.status === 'authenticated' || 
          channelInfo.status === 'connected') {
        return new Response(
          JSON.stringify({ 
            success: true,
            already_connected: true,
            message: 'WhatsApp already connected!'
          }),
          { status: 200, headers: corsHeaders }
        )
      }

      // If channel needs QR or is ready for QR
      if (channelInfo.status === 'qr' || 
          channelInfo.status === 'pending' || 
          channelInfo.status === 'launched' ||
          channelInfo.status === 'waiting' ||
          channelInfo.status === 'unauthorized') {
        
        const qrResult = await attemptGetQR(channelInfo.token || profile.whapi_token)
        if (qrResult.success) {
          return new Response(
            JSON.stringify(qrResult),
            { status: 200, headers: corsHeaders }
          )
        }
      }
    } else {
      console.log('❌ Channel check failed:', channelCheckRes.status)
    }
  }

  // STEP 2: Create new channel via Manager API
  console.log('🆕 Creating new channel via Manager API...')
  
  // Clean up old channel if exists
  if (profile?.instance_id) {
    try {
      await fetch(`https://manager.whapi.cloud/channels/${profile.instance_id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${partnerToken}` }
      })
      console.log('🗑️ Deleted old channel')
    } catch (e) {
      console.log('⚠️ Could not delete old channel:', e)
    }
  }

  // Create new channel
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

  const newChannel = await createRes.json()
  console.log('✅ New channel created:', {
    id: newChannel.id,
    name: newChannel.name,
    status: newChannel.status,
    hasToken: !!newChannel.token
  })

  // Save to database
  await supabase
    .from('profiles')
    .update({
      instance_id: newChannel.id,
      whapi_token: newChannel.token,
      instance_status: 'initializing',
      updated_at: new Date().toISOString()
    })
    .eq('id', userId)

  // STEP 3: Wait for channel initialization
  console.log('⏳ Waiting for channel initialization...')
  await delay(3000)

  // STEP 4: Poll channel status via Manager API until ready
  let attempts = 0
  const maxAttempts = 12 // 24 seconds total

  while (attempts < maxAttempts) {
    console.log(`🔄 Checking channel status (attempt ${attempts + 1}/${maxAttempts})...`)
    
    const statusRes = await fetch(
      `https://manager.whapi.cloud/channels/${newChannel.id}`,
      {
        headers: {
          'Authorization': `Bearer ${partnerToken}`,
          'Accept': 'application/json'
        }
      }
    )

    if (statusRes.ok) {
      const channelStatus = await statusRes.json()
      console.log('📊 Channel status:', channelStatus.status)

      // Update database with latest status
      await supabase
        .from('profiles')
        .update({
          instance_status: channelStatus.status,
          updated_at: new Date().toISOString()
        })
        .eq('id', userId)

      // Check if ready for QR
      if (channelStatus.status === 'qr' || 
          channelStatus.status === 'pending' || 
          channelStatus.status === 'launched' ||
          channelStatus.status === 'waiting' ||
          channelStatus.status === 'unauthorized') {
        
        // STEP 5: Configure webhook
        try {
          await configureWebhook(newChannel.token, supabaseUrl)
          console.log('🔗 Webhook configured')
        } catch (e) {
          console.log('⚠️ Webhook configuration warning:', e)
        }

        // STEP 6: Get QR code via Gate API
        const qrResult = await attemptGetQR(newChannel.token)
        if (qrResult.success) {
          return new Response(
            JSON.stringify(qrResult),
            { status: 200, headers: corsHeaders }
          )
        }
      }

      // If already connected
      if (channelStatus.status === 'active' || 
          channelStatus.status === 'authenticated' || 
          channelStatus.status === 'connected') {
        return new Response(
          JSON.stringify({ 
            success: true,
            already_connected: true,
            message: 'Channel connected successfully!'
          }),
          { status: 200, headers: corsHeaders }
        )
      }
    } else {
      console.log(`❌ Status check failed: ${statusRes.status}`)
    }

    attempts++
    await delay(2000)
  }

  // If we reach here, channel was created but not ready yet
  return new Response(
    JSON.stringify({ 
      success: true,
      message: 'Channel created successfully. Please try again in a few moments to get QR code.',
      instance_id: newChannel.id,
      status: 'initializing'
    }),
    { status: 200, headers: corsHeaders }
  )
}

// === ATTEMPT TO GET QR CODE VIA GATE API ===
async function attemptGetQR(channelToken: string) {
  console.log('📱 Attempting to get QR code via Gate API...')
  
  // Try the most common QR endpoints based on WHAPI docs
  const qrEndpoints = [
    'https://gate.whapi.cloud/screen',
    'https://gate.whapi.cloud/screenshot', 
    'https://gate.whapi.cloud/qr',
    'https://gate.whapi.cloud/auth/qr',
    'https://gate.whapi.cloud/instance/qr'
  ]

  for (const endpoint of qrEndpoints) {
    try {
      console.log(`🔍 Trying QR endpoint: ${endpoint}`)
      
      const qrRes = await fetch(endpoint, {
        headers: {
          'Authorization': `Bearer ${channelToken}`,
          'Accept': 'application/json'
        }
      })

      console.log(`📡 Response from ${endpoint}: ${qrRes.status}`)

      if (qrRes.ok) {
        const qrData = await qrRes.json()
        console.log('📋 QR response data keys:', Object.keys(qrData))
        
        // Look for QR in different possible response fields
        let qrCode = qrData.qr || qrData.screen || qrData.image || 
                    qrData.base64 || qrData.qrCode || qrData.data ||
                    qrData.screenshot || qrData.qr_code

        if (qrCode) {
          // Ensure proper data URI format
          if (!qrCode.startsWith('data:image/')) {
            qrCode = `data:image/png;base64,${qrCode}`
          }

          console.log('✅ QR code retrieved successfully!')
          
          return {
            success: true,
            qr_code: qrCode,
            message: 'Scan this QR code with WhatsApp'
          }
        } else {
          console.log('⚠️ QR data received but no QR field found:', qrData)
        }
      } else {
        const errorText = await qrRes.text()
        console.log(`❌ QR endpoint ${endpoint} error:`, errorText)
      }
    } catch (error) {
      console.log(`💥 Error trying ${endpoint}:`, error.message)
    }
  }

  // Try to initialize/start the instance first
  try {
    console.log('🔄 Trying to initialize instance...')
    
    const initEndpoints = [
      'https://gate.whapi.cloud/start',
      'https://gate.whapi.cloud/init',
      'https://gate.whapi.cloud/instance/start'
    ]

    for (const initEndpoint of initEndpoints) {
      try {
        const initRes = await fetch(initEndpoint, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${channelToken}`,
            'Content-Type': 'application/json'
          }
        })

        if (initRes.ok) {
          console.log(`✅ Instance initialized via ${initEndpoint}`)
          await delay(3000)
          
          // Try QR endpoints again after initialization
          return await attemptGetQR(channelToken)
        }
      } catch (e) {
        console.log(`Failed to init via ${initEndpoint}:`, e.message)
      }
    }
  } catch (e) {
    console.log('💥 Initialization attempt failed:', e)
  }

  return {
    success: false,
    message: 'QR code not available yet. The channel may still be initializing.'
  }
}

// === CONFIGURE WEBHOOK ===
async function configureWebhook(channelToken: string, supabaseUrl: string) {
  const webhookUrl = `${supabaseUrl}/functions/v1/whapi-webhook-simple`
  
  const webhookEndpoints = [
    'https://gate.whapi.cloud/settings',
    'https://gate.whapi.cloud/webhook',
    'https://gate.whapi.cloud/instance/webhook'
  ]

  for (const endpoint of webhookEndpoints) {
    try {
      const res = await fetch(endpoint, {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${channelToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          webhooks: [{
            url: webhookUrl,
            events: ['users', 'channel', 'messages'],
            mode: 'body'
          }]
        })
      })

      if (res.ok) {
        console.log(`✅ Webhook configured via ${endpoint}`)
        return
      }
    } catch (e) {
      console.log(`Failed webhook config via ${endpoint}:`, e.message)
    }
  }
}

// === STATUS CHECK ===
async function handleStatus(supabase: any, userId: string, partnerToken: string) {
  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .single()

  if (!profile?.instance_id) {
    return new Response(
      JSON.stringify({ 
        connected: false, 
        status: 'no_instance',
        message: 'No WhatsApp instance found'
      }),
      { status: 200, headers: corsHeaders }
    )
  }

  // Check status via Manager API first
  try {
    const managerRes = await fetch(
      `https://manager.whapi.cloud/channels/${profile.instance_id}`,
      {
        headers: {
          'Authorization': `Bearer ${partnerToken}`,
          'Accept': 'application/json'
        }
      }
    )

    if (managerRes.ok) {
      const channelInfo = await managerRes.json()
      const connected = channelInfo.status === 'active' || 
                       channelInfo.status === 'authenticated' || 
                       channelInfo.status === 'connected'

      // Update database
      await supabase
        .from('profiles')
        .update({ 
          instance_status: channelInfo.status,
          updated_at: new Date().toISOString()
        })
        .eq('id', userId)

      return new Response(
        JSON.stringify({ 
          connected,
          status: channelInfo.status,
          message: connected ? 'WhatsApp connected' : 'WhatsApp not connected'
        }),
        { status: 200, headers: corsHeaders }
      )
    }
  } catch (e) {
    console.log('Manager API status check failed:', e)
  }

  // Fallback to Gate API health check
  if (profile?.whapi_token) {
    try {
      const healthRes = await fetch('https://gate.whapi.cloud/health', {
        headers: { 'Authorization': `Bearer ${profile.whapi_token}` }
      })

      if (healthRes.ok) {
        const health = await healthRes.json()
        const connected = health.status === 'authenticated' || health.status === 'ready'

        return new Response(
          JSON.stringify({ 
            connected,
            status: health.status,
            message: connected ? 'WhatsApp connected' : 'WhatsApp not connected'
          }),
          { status: 200, headers: corsHeaders }
        )
      }
    } catch (e) {
      console.log('Gate API health check failed:', e)
    }
  }

  return new Response(
    JSON.stringify({ 
      connected: false, 
      status: 'error',
      message: 'Failed to check status'
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
