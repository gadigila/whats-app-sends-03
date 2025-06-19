
import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Loader2, AlertCircle, RefreshCw } from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import { useWhatsAppInstance } from '@/hooks/useWhatsAppInstance';
import { Alert, AlertDescription } from '@/components/ui/alert';

interface WhatsAppQrSectionProps {
  userId: string;
  onConnected: () => void;
  onMissingInstance: () => void;
}

const WhatsAppQrSection = ({ userId, onConnected, onMissingInstance }: WhatsAppQrSectionProps) => {
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [polling, setPolling] = useState(false);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [retryCount, setRetryCount] = useState(0);
  const { getQrCode, checkInstanceStatus, manualStatusSync } = useWhatsAppInstance();

  // Get QR code on mount
  useEffect(() => {
    handleGetQrCode();
  }, []);

  const handleGetQrCode = async () => {
    console.log('🔄 Getting QR code for user:', userId, 'attempt:', retryCount + 1);
    
    setQrCode(null);
    setStatus('loading');
    
    try {
      const result = await getQrCode.mutateAsync();
      
      console.log('📥 QR code result:', result);
      
      if (result?.success && result.qr_code) {
        console.log('✅ QR code received successfully');
        
        setQrCode(result.qr_code);
        setStatus('ready');
        setPolling(true);
        setRetryCount(0); // Reset retry count on success
        
        toast({
          title: "QR Code מוכן!",
          description: "סרוק את הקוד עם הוואטסאפ שלך",
        });
      } else {
        console.error('❌ QR code response invalid:', result);
        setStatus('error');
        throw new Error(result?.error || 'QR code not received from server');
      }
    } catch (err: any) {
      console.error('💥 QR code request failed:', err);
      setStatus('error');
      setRetryCount(prev => prev + 1);
      
      // Enhanced error handling
      if (err.message?.includes('Instance still initializing')) {
        console.log('⏳ Instance still initializing, will try manual sync');
        toast({
          title: "Instance עדיין מתאתחל",
          description: "נסה בדיקת סטטוס ידנית או המתן עוד קצת",
          variant: "destructive",
        });
      } else if (err.message?.includes('instance') || 
                 err.message?.includes('not found') || 
                 err.message?.includes('requiresNewInstance')) {
        console.log('🚨 Missing instance detected');
        onMissingInstance();
        return;
      } else {
        toast({
          title: "שגיאה בקבלת QR Code",
          description: err.message || 'אירעה שגיאה לא ידועה',
          variant: "destructive",
        });
      }
    }
  };

  const handleManualSync = async () => {
    console.log('🔄 Manual status sync triggered');
    try {
      const result = await manualStatusSync.mutateAsync();
      console.log('📥 Manual sync result:', result);
      
      if (result?.newStatus === 'unauthorized') {
        console.log('✅ Status synced to unauthorized, retrying QR...');
        toast({
          title: "סטטוס מסונכרן",
          description: "נסה כעת לקבל QR Code",
        });
        // Wait a moment then try QR again
        setTimeout(() => {
          handleGetQrCode();
        }, 1000);
      } else if (result?.newStatus === 'connected') {
        console.log('🎉 Already connected!');
        onConnected();
      } else if (result?.requiresNewInstance) {
        console.log('🚨 Instance requires recreation');
        onMissingInstance();
      } else {
        toast({
          title: "סטטוס נבדק",
          description: result?.message || "הסטטוס נבדק בהצלחה",
        });
      }
    } catch (err: any) {
      console.error('💥 Manual sync failed:', err);
      
      if (err.message?.includes('requiresNewInstance')) {
        console.log('🚨 Missing instance detected during manual sync');
        onMissingInstance();
      } else {
        toast({
          title: "שגיאה בסנכרון סטטוס",
          description: err.message || "נסה שוב מאוחר יותר",
          variant: "destructive",
        });
      }
    }
  };

  // Enhanced polling logic
  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (polling) {
      console.log('🔄 Starting connection polling every 3 seconds');
      interval = setInterval(async () => {
        try {
          console.log('📡 Checking connection status...');
          const result = await checkInstanceStatus.mutateAsync();
          
          console.log('📥 Status check response:', result);
          
          if (result?.connected || result?.status === 'connected') {
            console.log('🎉 WhatsApp connected successfully!');
            setPolling(false);
            setQrCode(null);
            onConnected();
            toast({
              title: "וואטסאפ מחובר!",
              description: "החיבור הושלם בהצלחה",
            });
          } else if (result?.requiresNewInstance) {
            console.log('🚨 Instance requires recreation');
            setPolling(false);
            setQrCode(null);
            onMissingInstance();
          }
        } catch (err: any) {
          console.error('💥 Status check failed:', err);
          
          // Check if status check indicates missing instance
          if (err.message?.includes('requiresNewInstance')) {
            console.log('🚨 Missing instance detected during polling');
            setPolling(false);
            setQrCode(null);
            onMissingInstance();
          }
        }
      }, 3000);
    }
    
    return () => {
      if (interval) {
        console.log('🛑 Stopping connection polling');
        clearInterval(interval);
      }
    };
  }, [polling, userId, onConnected, onMissingInstance]);

  if (status === 'error' && !qrCode) {
    return (
      <div className="text-center space-y-4">
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            שגיאה: {getQrCode.error?.message || 'לא ניתן לטעון QR Code'}
            {retryCount > 0 && (
              <div className="mt-2 text-xs">
                ניסיונות כושלים: {retryCount}
              </div>
            )}
          </AlertDescription>
        </Alert>
        <div className="flex gap-2 justify-center">
          <Button onClick={handleGetQrCode} disabled={getQrCode.isPending} variant="outline">
            {getQrCode.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <RefreshCw className="h-4 w-4 mr-2" />}
            נסה שוב
          </Button>
          <Button onClick={handleManualSync} disabled={manualStatusSync.isPending} variant="outline">
            {manualStatusSync.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <RefreshCw className="h-4 w-4 mr-2" />}
            סנכרן סטטוס
          </Button>
        </div>
        <div className="text-xs text-gray-500">
          אם הבעיה נמשכת, נסה ליצור instance חדש
        </div>
      </div>
    );
  }

  if (status === 'loading' || !qrCode) {
    return (
      <div className="flex flex-col items-center space-y-4">
        <Loader2 className="h-8 w-8 animate-spin text-gray-500" />
        <span className="text-gray-700">טוען QR Code...</span>
        <div className="text-xs text-gray-500 text-center">
          {retryCount > 0 ? (
            <div>ניסיון {retryCount + 1} - הערוץ מתחבר לשירות WHAPI...</div>
          ) : (
            <div>הערוץ מתחבר לשירות WHAPI. זה עשוי לקחת כ-60 שניות...</div>
          )}
        </div>
        <div className="flex gap-2">
          <Button onClick={handleManualSync} disabled={manualStatusSync.isPending} variant="outline" size="sm">
            {manualStatusSync.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <RefreshCw className="h-4 w-4 mr-2" />}
            בדוק סטטוס
          </Button>
          {retryCount >= 2 && (
            <Button onClick={handleGetQrCode} disabled={getQrCode.isPending} variant="outline" size="sm">
              {getQrCode.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <RefreshCw className="h-4 w-4 mr-2" />}
              נסה שוב
            </Button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="text-center space-y-6">
      <div className="p-4 bg-white rounded-2xl shadow-lg border w-fit mx-auto">
        <img
          src={qrCode}
          alt="WhatsApp QR Code"
          className="w-80 h-80 mx-auto rounded-lg"
          style={{
            maxWidth: '90vw',
            height: 'auto',
            aspectRatio: '1/1',
            imageRendering: 'crisp-edges'
          }}
          onError={(e) => {
            console.error('🖼️ QR image failed to load:', e);
            setStatus('error');
            toast({
              title: "שגיאה בטעינת QR Code",
              description: "נסה לרענן את הקוד",
              variant: "destructive",
            });
          }}
          onLoad={() => {
            console.log('✅ QR image loaded successfully');
          }}
        />
      </div>
      <div className="space-y-3">
        <h2 className="text-xl font-semibold text-gray-900">סרוק QR Code</h2>
        <div className="text-sm text-gray-600 space-y-1">
          <p>1. פתח וואטסאפ בטלפון שלך</p>
          <p>2. לך להגדרות ← מכשירים מקושרים</p>
          <p>3. לחץ על "קשר מכשיר" וסרוק את הקוד</p>
        </div>
        {polling && (
          <div className="flex items-center justify-center gap-2 text-sm text-blue-600">
            <Loader2 className="h-4 w-4 animate-spin" />
            מחכה לסריקת הקוד...
          </div>
        )}
      </div>
      <div className="flex gap-2 justify-center">
        <Button onClick={handleGetQrCode} variant="outline" disabled={getQrCode.isPending}>
          {getQrCode.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <RefreshCw className="h-4 w-4 mr-2" />}
          רענן QR Code
        </Button>
        <Button onClick={handleManualSync} disabled={manualStatusSync.isPending} variant="outline">
          {manualStatusSync.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <RefreshCw className="h-4 w-4 mr-2" />}
          סנכרן סטטוס
        </Button>
      </div>
    </div>
  );
};

export default WhatsAppQrSection;
