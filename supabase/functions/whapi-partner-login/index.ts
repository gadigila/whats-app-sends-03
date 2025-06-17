
import { createClient } from 'jsr:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface PartnerLoginRequest {
  userId: string
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const whapiPartnerEmail = Deno.env.get('WHAPI_PARTNER_EMAIL')!
    const whapiPartnerPassword = Deno.env.get('WHAPI_PARTNER_PASSWORD')!
    
    console.log('🔐 WHAPI Partner Login: Starting...')
    
    if (!whapiPartnerEmail || !whapiPartnerPassword) {
      console.error('❌ Missing WHAPI partner credentials')
      return new Response(
        JSON.stringify({ error: 'WHAPI partner credentials not configured' }),
        { status: 500, headers: corsHeaders }
      )
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey)
    const { userId }: PartnerLoginRequest = await req.json()

    if (!userId) {
      return new Response(
        JSON.stringify({ error: 'User ID is required' }),
        { status: 400, headers: corsHeaders }
      )
    }

    console.log('🔑 Logging in as WHAPI Partner...')

    // Step 1: Login as Partner to get access token
    const loginResponse = await fetch('https://gateway.whapi.cloud/partner/v1/auth/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email: whapiPartnerEmail,
        password: whapiPartnerPassword
      })
    })

    if (!loginResponse.ok) {
      const errorText = await loginResponse.text()
      console.error('❌ Partner login failed:', errorText)
      return new Response(
        JSON.stringify({ error: 'Failed to login as WHAPI partner', details: errorText }),
        { status: 400, headers: corsHeaders }
      )
    }

    const loginData = await loginResponse.json()
    const partnerAccessToken = loginData?.token

    if (!partnerAccessToken) {
      console.error('❌ No partner access token received')
      return new Response(
        JSON.stringify({ error: 'No partner access token received' }),
        { status: 400, headers: corsHeaders }
      )
    }

    console.log('✅ Partner login successful')

    // Step 2: Create new instance
    const webhookUrl = `${supabaseUrl}/functions/v1/whatsapp-webhook`
    
    const createInstanceResponse = await fetch('https://gateway.whapi.cloud/partner/v1/instances', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${partnerAccessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        name: `reecher_user_${userId}`,
        webhook: webhookUrl
      })
    })

    if (!createInstanceResponse.ok) {
      const errorText = await createInstanceResponse.text()
      console.error('❌ Instance creation failed:', errorText)
      return new Response(
        JSON.stringify({ error: 'Failed to create instance', details: errorText }),
        { status: 400, headers: corsHeaders }
      )
    }

    const instanceData = await createInstanceResponse.json()
    console.log('✅ Instance created:', instanceData)

    const instanceId = instanceData?.instanceId || instanceData?.id
    const instanceToken = instanceData?.token

    if (!instanceId) {
      console.error('❌ No instance ID received')
      return new Response(
        JSON.stringify({ error: 'No instance ID received from WHAPI' }),
        { status: 400, headers: corsHeaders }
      )
    }

    // Step 3: Save instance data to user profile
    const trialExpiresAt = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString()

    const { error: updateError } = await supabase
      .from('profiles')
      .update({
        instance_id: instanceId,
        whapi_token: instanceToken,
        instance_status: 'created',
        payment_plan: 'trial',
        trial_expires_at: trialExpiresAt,
        updated_at: new Date().toISOString()
      })
      .eq('id', userId)

    if (updateError) {
      console.error('❌ Failed to update user profile:', updateError)
      return new Response(
        JSON.stringify({ error: 'Failed to save instance data', details: updateError.message }),
        { status: 500, headers: corsHeaders }
      )
    }

    console.log('✅ Instance creation completed successfully')

    return new Response(
      JSON.stringify({
        success: true,
        instance_id: instanceId,
        trial_expires_at: trialExpiresAt,
        message: 'Instance created successfully'
      }),
      { status: 200, headers: corsHeaders }
    )

  } catch (error) {
    console.error('💥 Partner Login Error:', error)
    return new Response(
      JSON.stringify({ error: 'Internal server error', details: error.message }),
      { status: 500, headers: corsHeaders }
    )
  }
})
