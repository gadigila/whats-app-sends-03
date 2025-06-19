import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Loader2, CheckCircle, Smartphone, AlertCircle, RefreshCw, WifiOff, LogIn } from 'lucide-react';
import { useSimpleWhatsApp } from '@/hooks/useSimpleWhatsApp';
import { useAuth } from '@/contexts/AuthContext';
import { useNavigate } from 'react-router-dom';

const SimpleWhatsAppConnector = () => {
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { user } = useAuth();
  const navigate = useNavigate();
  
  const {
    status,
    isStatusLoading,
    groups,
    connectWhatsApp,
    checkStatus,
    disconnect,
    syncGroups,
    isConnecting,
    isDisconnecting,
    isSyncingGroups,
  } = useSimpleWhatsApp();

  // Debug user state
  console.log('🔐 SimpleWhatsAppConnector - User state:', {
    hasUser: !!user,
    userId: user?.id,
    userEmail: user?.email
  });

  // If no user, show login prompt
  if (!user) {
    return (
      <Card>
        <CardContent className="p-8 text-center">
          <div className="p-4 bg-blue-50 rounded-full w-fit mx-auto mb-6">
            <LogIn className="h-12 w-12 text-blue-600" />
          </div>
          <h3 className="text-xl font-semibold text-gray-900 mb-4">
            נדרשת התחברות
          </h3>
          <p className="text-gray-600 mb-6">
            כדי להתחבר לוואטסאפ, יש להתחבר תחילה למערכת
          </p>
          <Button
            onClick={() => navigate('/auth')}
            className="bg-blue-600 hover:bg-blue-700 text-white px-8 py-3 text-lg"
          >
            התחבר למערכת
          </Button>
        </CardContent>
      </Card>
    );
  }

  // Handle connection result
  useEffect(() => {
    if (connectWhatsApp.data) {
      console.log('🔄 Processing connection result:', connectWhatsApp.data);
      
      if (connectWhatsApp.data.qr_code) {
        console.log('📱 Setting QR code');
        setQrCode(connectWhatsApp.data.qr_code);
        setError(null);
      } else if (connectWhatsApp.data.already_connected) {
        console.log('✅ Already connected');
        setQrCode(null);
        setError(null);
      }
    }
  }, [connectWhatsApp.data]);

  // Handle connection errors
  useEffect(() => {
    if (connectWhatsApp.error) {
      console.error('❌ Connection error detected:', connectWhatsApp.error);
      setError(connectWhatsApp.error.message || 'שגיאה בחיבור');
      setQrCode(null);
    }
  }, [connectWhatsApp.error]);

  // Poll for status when QR is displayed
  useEffect(() => {
    let interval: NodeJS.Timeout;
    
    if (qrCode && !status?.connected) {
      console.log('🔄 Starting status polling for QR scan');
      interval = setInterval(() => {
        checkStatus.mutate();
      }, 3000);
    }
    
    return () => {
      if (interval) {
        console.log('⏹️ Stopping status polling');
        clearInterval(interval);
      }
    };
  }, [qrCode, status?.connected, checkStatus]);

  // Clear QR when connected
  useEffect(() => {
    if (status?.connected) {
      console.log('✅ Connected - clearing QR code');
      setQrCode(null);
      setError(null);
    }
  }, [status?.connected]);

  const handleConnect = () => {
    console.log('🚀 User clicked connect button');
    setError(null);
    setQrCode(null);
    connectWhatsApp.mutate();
  };

  const handleDisconnect = () => {
    console.log('🔌 User clicked disconnect button');
    setError(null);
    setQrCode(null);
    disconnect.mutate();
  };

  const handleSyncGroups = () => {
    console.log('🔄 User clicked sync groups button');
    syncGroups.mutate();
  };

  // Loading state
  if (isStatusLoading || isConnecting) {
    return (
      <Card>
        <CardContent className="p-8 text-center">
          <div className="flex flex-col items-center space-y-4">
            <Loader2 className="h-12 w-12 animate-spin text-blue-600" />
            <h3 className="text-lg font-semibold">
              {isConnecting ? 'מתחבר לוואטסאפ...' : 'בודק סטטוס...'}
            </h3>
            <p className="text-gray-600 text-sm">
              זה עשוי לקחת כמה שניות
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Connected state
  if (status?.connected) {
    return (
      <div className="space-y-6">
        <Card>
          <CardContent className="p-8 text-center">
            <div className="p-4 bg-green-50 rounded-full w-fit mx-auto mb-6">
              <CheckCircle className="h-12 w-12 text-green-600" />
            </div>
            <h2 className="text-xl font-semibold text-gray-900 mb-4">
              וואטסאפ מחובר!
            </h2>
            <p className="text-gray-600 mb-6">
              הוואטסאפ שלך מחובר ומוכן לשימוש. יש לך {groups.length} קבוצות.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <Button
                onClick={handleSyncGroups}
                disabled={isSyncingGroups}
                className="bg-blue-600 hover:bg-blue-700"
              >
                {isSyncingGroups ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <RefreshCw className="h-4 w-4 mr-2" />}
                סנכרן קבוצות ({groups.length})
              </Button>
              <Button
                onClick={handleDisconnect}
                variant="outline"
                disabled={isDisconnecting}
                className="text-red-600 border-red-600 hover:bg-red-50"
              >
                {isDisconnecting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <WifiOff className="h-4 w-4 mr-2" />}
                נתק
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Trial Status */}
        {status?.trial_expired && (
          <Card className="border-orange-200 bg-orange-50">
            <CardContent className="p-6">
              <div className="text-center">
                <h3 className="font-semibold text-orange-800 mb-2">תקופת הניסיון הסתיימה</h3>
                <p className="text-orange-700 text-sm">
                  לשימוש מלא בשירות, יש לשדרג לתוכנית בתשלום
                </p>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Groups List */}
        {groups.length > 0 && (
          <Card>
            <CardContent className="p-6">
              <h3 className="font-semibold mb-4">הקבוצות שלך ({groups.length})</h3>
              <div className="max-h-48 overflow-y-auto space-y-2">
                {groups.slice(0, 10).map((group: any) => (
                  <div key={group.id} className="flex items-center justify-between p-2 bg-gray-50 rounded">
                    <span className="text-sm">{group.name}</span>
                    <span className="text-xs text-gray-500">
                      {group.participants_count} משתתפים
                    </span>
                  </div>
                ))}
                {groups.length > 10 && (
                  <p className="text-xs text-gray-500 text-center">
                    ועוד {groups.length - 10} קבוצות...
                  </p>
                )}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <Card>
        <CardContent className="p-8 text-center">
          <div className="flex flex-col items-center space-y-4">
            <AlertCircle className="h-12 w-12 text-red-600" />
            <h3 className="text-lg font-semibold text-red-800">בעיה בחיבור</h3>
            <p className="text-red-600 text-sm">{error}</p>
            <Button
              onClick={handleConnect}
              variant="outline"
              className="border-blue-600 text-blue-600 hover:bg-blue-50"
            >
              נסה שוב
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  // QR Code display
  if (qrCode) {
    return (
      <Card>
        <CardContent className="p-8 text-center space-y-6">
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
            />
          </div>
          
          <div className="space-y-3">
            <h3 className="text-xl font-semibold">סרוק עם הוואטסאפ שלך</h3>
            <div className="text-sm text-gray-600 space-y-1">
              <p>1. פתח וואטסאפ בטלפון</p>
              <p>2. לך להגדרות ← מכשירים מקושרים</p>
              <p>3. לחץ "קשר מכשיר" וסרוק</p>
            </div>
            
            <div className="flex items-center justify-center gap-2 text-sm text-blue-600 mt-4">
              <Loader2 className="h-4 w-4 animate-spin" />
              מחכה לסריקה...
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Initial state
  return (
    <Card>
      <CardContent className="p-8 text-center">
        <div className="p-4 bg-green-50 rounded-full w-fit mx-auto mb-6">
          <Smartphone className="h-12 w-12 text-green-600" />
        </div>
        <h3 className="text-xl font-semibold text-gray-900 mb-4">
          חבר וואטסאפ
        </h3>
        <p className="text-gray-600 mb-6">
          חבר את הוואטסאפ שלך כדי להתחיל לשלוח הודעות לקבוצות
        </p>
        <Button
          onClick={handleConnect}
          className="bg-green-600 hover:bg-green-700 text-white px-8 py-3 text-lg"
          disabled={isConnecting}
        >
          {isConnecting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
          התחבר עכשיו
        </Button>
      </CardContent>
    </Card>
  );
};

export default SimpleWhatsAppConnector;
