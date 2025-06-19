
-- Complete MVP Database Schema - Clean Rebuild
-- Drop existing tables to start fresh
DROP TABLE IF EXISTS public.message_history CASCADE;
DROP TABLE IF EXISTS public.group_tag_assignments CASCADE;
DROP TABLE IF EXISTS public.group_tags CASCADE;
DROP TABLE IF EXISTS public.scheduled_messages CASCADE;
DROP TABLE IF EXISTS public.whatsapp_groups CASCADE;

-- Update profiles table structure
ALTER TABLE public.profiles 
DROP COLUMN IF EXISTS billing_status,
DROP COLUMN IF EXISTS trial_ends_at,
DROP COLUMN IF EXISTS whapi_channel_id;

-- Ensure profiles has the right columns
ALTER TABLE public.profiles 
ADD COLUMN IF NOT EXISTS whapi_token TEXT,
ADD COLUMN IF NOT EXISTS instance_id TEXT,
ADD COLUMN IF NOT EXISTS instance_status TEXT DEFAULT 'disconnected',
ADD COLUMN IF NOT EXISTS payment_plan TEXT DEFAULT 'trial',
ADD COLUMN IF NOT EXISTS trial_expires_at TIMESTAMP WITH TIME ZONE DEFAULT (now() + interval '3 days');

-- 1. WhatsApp groups table
CREATE TABLE public.whatsapp_groups (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  group_id TEXT NOT NULL, -- WhatsApp group ID
  name TEXT NOT NULL,
  description TEXT,
  participants_count INTEGER DEFAULT 0,
  is_admin BOOLEAN DEFAULT false,
  avatar_url TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  UNIQUE(user_id, group_id)
);

-- 2. Group tags/segments (super groups)
CREATE TABLE public.group_tags (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  name TEXT NOT NULL, -- e.g., "VIP Clients"
  color TEXT DEFAULT '#3B82F6',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  UNIQUE(user_id, name)
);

-- 3. Group tag assignments
CREATE TABLE public.group_tag_assignments (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  group_id UUID REFERENCES public.whatsapp_groups(id) ON DELETE CASCADE,
  tag_id UUID REFERENCES public.group_tags(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  UNIQUE(group_id, tag_id)
);

-- 4. Scheduled messages
CREATE TABLE public.scheduled_messages (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  message TEXT NOT NULL,
  media_url TEXT, -- For images/files
  media_type TEXT, -- image, document, etc.
  group_ids TEXT[] NOT NULL, -- Array of WhatsApp group IDs
  tag_ids TEXT[], -- Send to groups with these tags
  send_at TIMESTAMP WITH TIME ZONE NOT NULL,
  status TEXT DEFAULT 'pending', -- pending, sending, sent, failed, cancelled
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- 5. Message history
CREATE TABLE public.message_history (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  scheduled_message_id UUID REFERENCES public.scheduled_messages(id) ON DELETE SET NULL,
  group_id TEXT NOT NULL,
  group_name TEXT,
  message TEXT NOT NULL,
  media_url TEXT,
  status TEXT NOT NULL, -- sent, failed
  error_message TEXT,
  sent_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  whapi_message_id TEXT
);

-- Enable RLS on all tables
ALTER TABLE public.whatsapp_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.group_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.group_tag_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scheduled_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.message_history ENABLE ROW LEVEL SECURITY;

-- RLS policies (users can only see their own data)
DROP POLICY IF EXISTS "Users own data" ON whatsapp_groups;
DROP POLICY IF EXISTS "Users own data" ON group_tags;
DROP POLICY IF EXISTS "Users own data" ON group_tag_assignments;
DROP POLICY IF EXISTS "Users own data" ON scheduled_messages;
DROP POLICY IF EXISTS "Users own data" ON message_history;

CREATE POLICY "Users own data" ON whatsapp_groups FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Users own data" ON group_tags FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Users own data" ON scheduled_messages FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Users own data" ON message_history FOR ALL USING (auth.uid() = user_id);

-- Group tag assignments policy (through groups)
CREATE POLICY "Users own data" ON group_tag_assignments FOR ALL USING (
  EXISTS (
    SELECT 1 FROM whatsapp_groups 
    WHERE whatsapp_groups.id = group_tag_assignments.group_id 
    AND whatsapp_groups.user_id = auth.uid()
  )
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_scheduled_messages_status_send_at ON scheduled_messages(status, send_at);
CREATE INDEX IF NOT EXISTS idx_message_history_user_sent ON message_history(user_id, sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_whatsapp_groups_user ON whatsapp_groups(user_id);
CREATE INDEX IF NOT EXISTS idx_profiles_trial_expires ON profiles(trial_expires_at) WHERE payment_plan = 'trial';

-- Update existing profiles to have correct default values
UPDATE public.profiles 
SET 
  payment_plan = 'trial',
  instance_status = 'disconnected',
  trial_expires_at = created_at + interval '3 days'
WHERE payment_plan IS NULL OR instance_status IS NULL OR trial_expires_at IS NULL;
