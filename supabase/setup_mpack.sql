-- MeshPack mpack — tek seferlik kurulum
-- Supabase Dashboard → SQL Editor → New query → Run
-- (Önce migration, sonra seed — veya bu dosyayı baştan sona çalıştırın)

-- ═══════════════════════════════════════════════════════════════
-- 1) ŞEMA (supabase/migrations/20260706100000_meshpack_cloud.sql ile aynı)
-- ═══════════════════════════════════════════════════════════════

CREATE TYPE org_type AS ENUM ('clinic', 'lab');

CREATE TABLE organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  org_type org_type NOT NULL,
  pairing_code TEXT UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL DEFAULT '',
  active_organization_id UUID REFERENCES organizations(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE organization_members (
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'staff' CHECK (role IN ('admin', 'staff')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, user_id)
);

CREATE TABLE clinic_lab_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  lab_org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('pending', 'active', 'revoked')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (clinic_org_id, lab_org_id)
);

CREATE TYPE cloud_case_status AS ENUM (
  'sent', 'received', 'in_production', 'quality_check', 'shipped', 'completed', 'cancelled'
);

CREATE TABLE cloud_cases (
  id UUID PRIMARY KEY,
  clinic_org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  lab_org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  case_number TEXT NOT NULL,
  session_day DATE NOT NULL,
  status cloud_case_status NOT NULL DEFAULT 'sent',
  patient_display_name TEXT NOT NULL DEFAULT '',
  patient_surname TEXT NOT NULL DEFAULT '',
  patient_first_name TEXT NOT NULL DEFAULT '',
  lab_notes TEXT NOT NULL DEFAULT '',
  tooth_shade TEXT NOT NULL DEFAULT '',
  dental_plan JSONB NOT NULL DEFAULT '{"teeth":{}}',
  annotations JSONB NOT NULL DEFAULT '{"version":1,"markers":[]}',
  manifest JSONB NOT NULL DEFAULT '{}',
  package_storage_path TEXT,
  package_size_bytes BIGINT,
  sent_at TIMESTAMPTZ,
  received_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (clinic_org_id, case_number)
);

CREATE INDEX idx_cloud_cases_lab_queue ON cloud_cases (lab_org_id, status, sent_at DESC);
CREATE INDEX idx_cloud_cases_clinic ON cloud_cases (clinic_org_id, updated_at DESC);

CREATE TABLE case_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id UUID NOT NULL REFERENCES cloud_cases(id) ON DELETE CASCADE,
  author_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  author_org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  body TEXT NOT NULL CHECK (char_length(trim(body)) > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_case_messages_case ON case_messages (case_id, created_at ASC);

CREATE TYPE notification_type AS ENUM ('new_case', 'new_message', 'status_change', 'link_request');

CREATE TABLE notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  case_id UUID REFERENCES cloud_cases(id) ON DELETE CASCADE,
  type notification_type NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_notifications_user ON notifications (user_id, read_at NULLS FIRST, created_at DESC);

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER profiles_updated_at BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER cloud_cases_updated_at BEFORE UPDATE ON cloud_cases
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO profiles (id, display_name)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email, '@', 1)));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

CREATE OR REPLACE FUNCTION notify_case_message()
RETURNS TRIGGER AS $$
DECLARE
  c cloud_cases%ROWTYPE;
  member RECORD;
  author_name TEXT;
BEGIN
  SELECT * INTO c FROM cloud_cases WHERE id = NEW.case_id;
  SELECT display_name INTO author_name FROM profiles WHERE id = NEW.author_user_id;
  FOR member IN
    SELECT om.user_id FROM organization_members om
    WHERE om.organization_id IN (c.clinic_org_id, c.lab_org_id)
      AND om.user_id != NEW.author_user_id
  LOOP
    INSERT INTO notifications (user_id, organization_id, case_id, type, title, body)
    VALUES (member.user_id, NEW.author_org_id, NEW.case_id, 'new_message',
      c.case_number || ' — yeni mesaj', left(author_name || ': ' || NEW.body, 500));
  END LOOP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_case_message_notify
  AFTER INSERT ON case_messages
  FOR EACH ROW EXECUTE FUNCTION notify_case_message();

CREATE OR REPLACE FUNCTION user_org_ids()
RETURNS SETOF UUID AS $$
  SELECT organization_id FROM organization_members WHERE user_id = auth.uid();
$$ LANGUAGE sql STABLE SECURITY DEFINER;

CREATE OR REPLACE FUNCTION user_can_access_case(p_case_id UUID)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM cloud_cases c
    WHERE c.id = p_case_id
      AND (c.clinic_org_id IN (SELECT user_org_ids()) OR c.lab_org_id IN (SELECT user_org_ids()))
  );
$$ LANGUAGE sql STABLE SECURITY DEFINER;

ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE organization_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE clinic_lab_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE cloud_cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE case_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY org_select ON organizations FOR SELECT USING (id IN (SELECT user_org_ids()));
CREATE POLICY profiles_select ON profiles FOR SELECT
  USING (id = auth.uid() OR id IN (
    SELECT om.user_id FROM organization_members om WHERE om.organization_id IN (SELECT user_org_ids())));
CREATE POLICY profiles_update ON profiles FOR UPDATE USING (id = auth.uid());
CREATE POLICY members_select ON organization_members FOR SELECT USING (organization_id IN (SELECT user_org_ids()));
CREATE POLICY links_select ON clinic_lab_links FOR SELECT
  USING (clinic_org_id IN (SELECT user_org_ids()) OR lab_org_id IN (SELECT user_org_ids()));
CREATE POLICY cases_select ON cloud_cases FOR SELECT
  USING (clinic_org_id IN (SELECT user_org_ids()) OR lab_org_id IN (SELECT user_org_ids()));
CREATE POLICY cases_insert ON cloud_cases FOR INSERT WITH CHECK (clinic_org_id IN (SELECT user_org_ids()));
CREATE POLICY cases_update ON cloud_cases FOR UPDATE
  USING (clinic_org_id IN (SELECT user_org_ids()) OR lab_org_id IN (SELECT user_org_ids()));
CREATE POLICY messages_select ON case_messages FOR SELECT USING (user_can_access_case(case_id));
CREATE POLICY messages_insert ON case_messages FOR INSERT WITH CHECK (
  author_user_id = auth.uid() AND author_org_id IN (SELECT user_org_ids()) AND user_can_access_case(case_id));
CREATE POLICY notifications_select ON notifications FOR SELECT USING (user_id = auth.uid());
CREATE POLICY notifications_update ON notifications FOR UPDATE USING (user_id = auth.uid());

INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('case-packages', 'case-packages', false, 524288000)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY case_packages_select ON storage.objects FOR SELECT
  USING (bucket_id = 'case-packages' AND (storage.foldername(name))[1] IN (
    SELECT id::text FROM organizations WHERE id IN (SELECT user_org_ids())));
CREATE POLICY case_packages_insert ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'case-packages' AND (storage.foldername(name))[1] IN (
    SELECT id::text FROM organizations WHERE id IN (SELECT user_org_ids())));

ALTER PUBLICATION supabase_realtime ADD TABLE case_messages;
ALTER PUBLICATION supabase_realtime ADD TABLE notifications;
ALTER PUBLICATION supabase_realtime ADD TABLE cloud_cases;

-- ═══════════════════════════════════════════════════════════════
-- 2) DEMO ORGANİZASYONLAR
-- ═══════════════════════════════════════════════════════════════

INSERT INTO organizations (id, name, org_type, pairing_code) VALUES
  ('a1000000-0000-4000-8000-000000000001', 'Demo Klinik', 'clinic', 'KLINIK-DEMO'),
  ('a1000000-0000-4000-8000-000000000002', 'Demo Lab', 'lab', 'LAB-DEMO')
ON CONFLICT (id) DO NOTHING;

INSERT INTO clinic_lab_links (clinic_org_id, lab_org_id) VALUES
  ('a1000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000002')
ON CONFLICT (clinic_org_id, lab_org_id) DO NOTHING;

-- 3) KULLANICIYI ORGANİZASYONA BAĞLA
-- Artık gerek yok — uygulama içinden Kayıt ol / Organizasyon oluştur kullanın.
-- (Eski manuel yöntem: organization_members + profiles UPDATE)

-- ═══════════════════════════════════════════════════════════════
-- 4) ONBOARDING RPC (kayıt + lab eşleştirme)
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION register_meshpack_organization(
  p_org_name TEXT,
  p_org_type org_type
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_org_id UUID;
  v_code TEXT;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Oturum gerekli — önce giriş yapın';
  END IF;

  IF trim(p_org_name) = '' THEN
    RAISE EXCEPTION 'Organizasyon adı boş olamaz';
  END IF;

  IF EXISTS (SELECT 1 FROM organization_members WHERE user_id = v_user_id) THEN
    RAISE EXCEPTION 'Bu hesap zaten bir organizasyona bağlı';
  END IF;

  v_code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));

  INSERT INTO organizations (name, org_type, pairing_code)
  VALUES (trim(p_org_name), p_org_type, v_code)
  RETURNING id INTO v_org_id;

  INSERT INTO organization_members (organization_id, user_id, role)
  VALUES (v_org_id, v_user_id, 'admin');

  UPDATE profiles SET active_organization_id = v_org_id WHERE id = v_user_id;

  RETURN v_org_id;
END;
$$;

CREATE OR REPLACE FUNCTION link_clinic_to_lab(p_lab_pairing_code TEXT)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_clinic_org_id UUID;
  v_clinic_type org_type;
  v_lab_org_id UUID;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Oturum gerekli';
  END IF;

  SELECT p.active_organization_id, o.org_type
  INTO v_clinic_org_id, v_clinic_type
  FROM profiles p
  JOIN organizations o ON o.id = p.active_organization_id
  WHERE p.id = v_user_id;

  IF v_clinic_org_id IS NULL OR v_clinic_type != 'clinic' THEN
    RAISE EXCEPTION 'Sadece klinik hesabı lab ile eşleşebilir';
  END IF;

  SELECT id INTO v_lab_org_id
  FROM organizations
  WHERE upper(trim(pairing_code)) = upper(trim(p_lab_pairing_code))
    AND org_type = 'lab';

  IF v_lab_org_id IS NULL THEN
    RAISE EXCEPTION 'Lab bulunamadı — eşleştirme kodunu kontrol edin';
  END IF;

  INSERT INTO clinic_lab_links (clinic_org_id, lab_org_id, status)
  VALUES (v_clinic_org_id, v_lab_org_id, 'active')
  ON CONFLICT (clinic_org_id, lab_org_id) DO UPDATE SET status = 'active';

  RETURN v_lab_org_id;
END;
$$;

REVOKE ALL ON FUNCTION register_meshpack_organization(TEXT, org_type) FROM PUBLIC;
REVOKE ALL ON FUNCTION link_clinic_to_lab(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION register_meshpack_organization(TEXT, org_type) TO authenticated;
GRANT EXECUTE ON FUNCTION link_clinic_to_lab(TEXT) TO authenticated;

-- Lab listesi ve çoklu eşleştirme için ayrıca çalıştırın:
-- migrations/20260706120000_meshpack_lab_linking.sql
