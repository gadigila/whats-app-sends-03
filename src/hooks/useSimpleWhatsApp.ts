import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from '@/hooks/use-toast';

interface SimpleWhapiRequest {
  userId: string;
  action: 'connect' | 'status' | 'disconnect' | 'sync-groups' | 'send-message' | 'schedule-message' | 'get-messages';
  data?: any;
}

const callSimpleWhapi = async (request: SimpleWhapiRequest) => {
  console.log('📞 Calling simple WHAPI:', request);
  
  // Add more detailed logging
  console.log('🔍 Request details:', {
    userId: request.userId,
    action: request.action,
    hasData: !!request.data
  });
  
  try {
    const { data, error } = await supabase.functions.invoke('whapi-simple', {
      body: request
    });
    
    if (error) {
      console.error('❌ WHAPI Error:', error);
      throw error;
    }
    
    console.log('✅ WHAPI Response:', data);
    return data;
  } catch (err) {
    console.error('💥 Failed to call WHAPI function:', err);
    throw err;
  }
};

export const useSimpleWhatsApp = () => {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  // Add extensive logging for user state
  console.log('🔐 Auth state in useSimpleWhatsApp:', {
    hasUser: !!user,
    userId: user?.id,
    userEmail: user?.email
  });

  // Connect/Get QR Code
  const connectWhatsApp = useMutation({
    mutationFn: async () => {
      console.log('🚀 Starting WhatsApp connect mutation');
      
      if (!user?.id) {
        console.error('❌ No user ID available for connection');
        throw new Error('אין משתמש מחובר - יש להתחבר תחילה');
      }
      
      console.log('📱 Calling WHAPI connect for user:', user.id);
      
      return callSimpleWhapi({
        userId: user.id,
        action: 'connect'
      });
    },
    onSuccess: (data) => {
      console.log('✅ Connect success:', data);
      
      if (data?.already_connected) {
        toast({
          title: "✅ כבר מחובר",
          description: "הוואטסאפ שלך כבר מחובר!",
        });
      } else if (data?.qr_code) {
        toast({
          title: "📱 קוד QR מוכן",
          description: "סרוק עם הוואטסאפ שלך",
        });
      }
      queryClient.invalidateQueries({ queryKey: ['whatsapp-status'] });
    },
    onError: (error) => {
      console.error('❌ Connection error:', error);
      toast({
        title: "❌ שגיאה בחיבור",
        description: error.message || "נסה שוב",
        variant: "destructive",
      });
    }
  });

  // Check Status
  const checkStatus = useMutation({
    mutationFn: async () => {
      if (!user?.id) {
        console.error('❌ No user ID for status check');
        throw new Error('אין משתמש מחובר');
      }
      
      console.log('🔍 Checking status for user:', user.id);
      
      return callSimpleWhapi({
        userId: user.id,
        action: 'status'
      });
    },
    onSuccess: (data) => {
      console.log('📊 Status check result:', data);
      queryClient.setQueryData(['whatsapp-status'], data);
    },
    onError: (error) => {
      console.error('❌ Status check error:', error);
    }
  });

  // Disconnect
  const disconnect = useMutation({
    mutationFn: async () => {
      if (!user?.id) throw new Error('User not authenticated');
      return callSimpleWhapi({
        userId: user.id,
        action: 'disconnect'
      });
    },
    onSuccess: () => {
      toast({
        title: "🔌 מנותק",
        description: "הוואטסאפ נותק בהצלחה",
      });
      queryClient.invalidateQueries({ queryKey: ['whatsapp-status'] });
      queryClient.invalidateQueries({ queryKey: ['whatsapp-groups'] });
    }
  });

  // Sync Groups
  const syncGroups = useMutation({
    mutationFn: async () => {
      if (!user?.id) throw new Error('User not authenticated');
      return callSimpleWhapi({
        userId: user.id,
        action: 'sync-groups'
      });
    },
    onSuccess: (data) => {
      toast({
        title: "📱 קבוצות סונכרנו",
        description: `${data.groups_count} קבוצות נטענו בהצלחה`,
      });
      queryClient.invalidateQueries({ queryKey: ['whatsapp-groups'] });
    }
  });

  // Send Message
  const sendMessage = useMutation({
    mutationFn: async (data: {
      groupIds: string[];
      message: string;
      mediaUrl?: string;
      mediaType?: string;
    }) => {
      if (!user?.id) throw new Error('User not authenticated');
      return callSimpleWhapi({
        userId: user.id,
        action: 'send-message',
        data
      });
    },
    onSuccess: (data) => {
      const successCount = data.results?.filter((r: any) => r.success).length || 0;
      const totalCount = data.results?.length || 0;
      
      toast({
        title: "📤 הודעה נשלחה",
        description: `נשלחה ל-${successCount} מתוך ${totalCount} קבוצות`,
      });
      
      queryClient.invalidateQueries({ queryKey: ['message-history'] });
    }
  });

  // Schedule Message
  const scheduleMessage = useMutation({
    mutationFn: async (data: {
      message: string;
      sendAt: string;
      groupIds?: string[];
      tagIds?: string[];
      mediaUrl?: string;
      mediaType?: string;
    }) => {
      if (!user?.id) throw new Error('User not authenticated');
      return callSimpleWhapi({
        userId: user.id,
        action: 'schedule-message',
        data
      });
    },
    onSuccess: () => {
      toast({
        title: "⏰ הודעה נקבעה",
        description: "ההודעה נקבעה לשליחה",
      });
      queryClient.invalidateQueries({ queryKey: ['scheduled-messages'] });
    }
  });

  // Get Status Query
  const statusQuery = useQuery({
    queryKey: ['whatsapp-status'],
    queryFn: async () => {
      if (!user?.id) {
        console.log('⚠️ No user ID for status query');
        return null;
      }
      
      console.log('🔄 Running status query for user:', user.id);
      
      return callSimpleWhapi({
        userId: user.id,
        action: 'status'
      });
    },
    enabled: !!user?.id,
    refetchInterval: 5000, // Check every 5 seconds
  });

  // Get Groups Query
  const groupsQuery = useQuery({
    queryKey: ['whatsapp-groups'],
    queryFn: async () => {
      if (!user?.id) return [];
      const { data } = await supabase
        .from('whatsapp_groups')
        .select('*')
        .order('name');
      return data || [];
    },
    enabled: !!user?.id,
  });

  // Get Scheduled Messages Query
  const scheduledMessagesQuery = useQuery({
    queryKey: ['scheduled-messages'],
    queryFn: async () => {
      if (!user?.id) return [];
      const result = await callSimpleWhapi({
        userId: user.id,
        action: 'get-messages',
        data: { type: 'scheduled' }
      });
      return result.messages || [];
    },
    enabled: !!user?.id,
  });

  // Get Message History Query
  const messageHistoryQuery = useQuery({
    queryKey: ['message-history'],
    queryFn: async () => {
      if (!user?.id) return [];
      const result = await callSimpleWhapi({
        userId: user.id,
        action: 'get-messages',
        data: { type: 'history' }
      });
      return result.messages || [];
    },
    enabled: !!user?.id,
  });

  return {
    // Mutations
    connectWhatsApp,
    checkStatus,
    disconnect,
    syncGroups,
    sendMessage,
    scheduleMessage,
    
    // Queries
    status: statusQuery.data,
    isStatusLoading: statusQuery.isLoading,
    groups: groupsQuery.data || [],
    isGroupsLoading: groupsQuery.isLoading,
    scheduledMessages: scheduledMessagesQuery.data || [],
    messageHistory: messageHistoryQuery.data || [],
    
    // Loading states
    isConnecting: connectWhatsApp.isPending,
    isDisconnecting: disconnect.isPending,
    isSyncingGroups: syncGroups.isPending,
    isSendingMessage: sendMessage.isPending,
    isSchedulingMessage: scheduleMessage.isPending,
  };
};
