
import type { GetQrRequest } from './types.ts'
import { DatabaseService } from './database.ts'
import { QrProcessor } from './qr-processor.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Helper function to delay
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

class WhapiService {
  private baseURL = 'https://gate.whapi.cloud'
  
  async getQrCode(instanceId: string, channelToken: string): Promise<Response> {
    if (!channelToken) {
      throw new Error('Channel token is required for QR generation')
    }

    const qrEndpoint = `${this.baseURL}/instance/qr?id=${instanceId}`
    
    console.log('📡 Requesting QR from WHAPI:', qrEndpoint)
    console.log('🔑 Using instance ID:', instanceId)

    return await fetch(qrEndpoint, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${channelToken}`,
        'Accept': 'application/json'
      }
    })
  }

  async checkChannelAccessibility(channelToken: string): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseURL}/settings`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${channelToken}`
        }
      })
      return response.ok
    } catch {
      return false
    }
  }
}

async function attemptQrRetrieval(whapiService: WhapiService, qrProcessor: QrProcessor, instanceId: string, channelToken: string, retryCount = 0): Promise<any> {
  const maxRetries = 2
  const baseDelay = 2000
  
  try {
    console.log(`🔄 QR retrieval attempt ${retryCount + 1}/${maxRetries + 1}`)
    
    if (!channelToken) {
      throw new Error('Channel token is required for QR generation')
    }

    // Verify channel accessibility first
    console.log('🔍 Verifying channel accessibility...')
    const isAccessible = await whapiService.checkChannelAccessibility(channelToken)
    
    if (!isAccessible) {
      console.error('❌ Channel not accessible')
      return qrProcessor.createErrorResponse(404, 'Channel not accessible', instanceId)
    }

    console.log('✅ Channel verified as accessible')

    // Get QR code using correct WHAPI endpoint
    const qrResponse = await whapiService.getQrCode(instanceId, channelToken)
    console.log('📥 WHAPI QR response status:', qrResponse.status)

    if (qrResponse.ok) {
      const qrData = await qrResponse.json()
      console.log('✅ QR data received:', Object.keys(qrData))
      return qrProcessor.processQrResponse(qrData)
    } else {
      const errorText = await qrResponse.text()
      console.error(`❌ QR request failed (attempt ${retryCount + 1}):`, {
        status: qrResponse.status,
        error: errorText,
        instanceId
      })
      
      const errorResult = qrProcessor.createErrorResponse(qrResponse.status, errorText, instanceId)
      
      // Retry logic for retryable errors
      if (errorResult.retryable && retryCount < maxRetries) {
        const delayMs = baseDelay * Math.pow(2, retryCount)
        console.log(`⏳ Retrying in ${delayMs}ms...`)
        await delay(delayMs)
        return attemptQrRetrieval(whapiService, qrProcessor, instanceId, channelToken, retryCount + 1)
      }
      
      return errorResult
    }
  } catch (networkError) {
    console.error(`❌ Network error on attempt ${retryCount + 1}:`, networkError)
    
    if (retryCount < maxRetries) {
      const delayMs = baseDelay * Math.pow(2, retryCount)
      console.log(`⏳ Retrying after network error in ${delayMs}ms...`)
      await delay(delayMs)
      return attemptQrRetrieval(whapiService, qrProcessor, instanceId, channelToken, retryCount + 1)
    }
    
    return qrProcessor.createNetworkErrorResponse(networkError)
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const requestBody = await req.text()
    console.log('📱 Request body received:', requestBody)
    
    const { userId }: GetQrRequest = JSON.parse(requestBody)
    console.log('📱 Getting QR for user:', userId)

    if (!userId) {
      return new Response(
        JSON.stringify({ error: 'User ID is required' }),
        { status: 400, headers: corsHeaders }
      )
    }

    const dbService = new DatabaseService()
    const whapiService = new WhapiService()
    const qrProcessor = new QrProcessor()

    // Get user's channel info
    const { profile, error: profileError } = await dbService.getUserProfile(userId)

    if (profileError || !profile) {
      console.error('❌ Error fetching user profile:', profileError)
      return new Response(
        JSON.stringify({ error: 'User profile not found' }),
        { status: 404, headers: corsHeaders }
      )
    }

    console.log('📋 Profile data:', {
      hasInstanceId: !!profile.instance_id,
      hasToken: !!profile.whapi_token,
      instanceStatus: profile.instance_status,
      instanceId: profile.instance_id
    })

    if (!profile.instance_id || !profile.whapi_token) {
      console.log('🚨 No instance or token found, requires new instance')
      return new Response(
        JSON.stringify(qrProcessor.createMissingInstanceResponse()),
        { status: 400, headers: corsHeaders }
      )
    }

    console.log('🔍 Found instance ID:', profile.instance_id)
    console.log('🔑 Using channel token for QR generation')

    // Check channel age for initialization timing
    const channelAge = await dbService.getChannelAge(userId)
    if (channelAge !== null && channelAge < 60000) {
      const remainingWait = Math.max(0, 60000 - channelAge)
      if (remainingWait > 0) {
        console.log(`⏳ Channel is ${channelAge}ms old, waiting additional ${remainingWait}ms...`)
        await delay(remainingWait)
      }
    }

    // Attempt QR retrieval
    const result = await attemptQrRetrieval(whapiService, qrProcessor, profile.instance_id, profile.whapi_token)
    
    // Handle 404 errors by cleaning up database
    if (!result.success && (result.details?.status === 404 || result.requiresNewInstance)) {
      console.log('🗑️ Channel not found or invalid, cleaning up database...')
      await dbService.clearInvalidInstance(userId)
      
      return new Response(
        JSON.stringify(qrProcessor.createMissingInstanceResponse()),
        { status: 404, headers: corsHeaders }
      )
    }
    
    return new Response(
      JSON.stringify(result),
      { status: result.success ? 200 : 400, headers: corsHeaders }
    )

  } catch (error) {
    console.error('💥 QR Code Error:', error)
    return new Response(
      JSON.stringify({ error: 'Internal server error', details: error.message }),
      { status: 500, headers: corsHeaders }
    )
  }
})
