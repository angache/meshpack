-- MeshPack Cloud — uygulama içi kayıt ve lab eşleştirme (manuel SQL gerekmez)

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
