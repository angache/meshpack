-- MeshPack Cloud — lab listesi ve çoklu eşleştirme yöntemleri
-- 1) Kod ile anında bağlan (mevcut link_clinic_to_lab)
-- 2) Klinik lab arar → istek gönderir → lab onaylar
-- 3) Lab klinik kodu ile istek gönderir → klinik onaylar

ALTER TABLE clinic_lab_links
  ADD COLUMN IF NOT EXISTS requested_by_org_id UUID REFERENCES organizations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS request_note TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS responded_at TIMESTAMPTZ;

-- ── Yardımcı: link isteği bildirimi ─────────────────────────────
CREATE OR REPLACE FUNCTION notify_link_request(
  p_target_org_id UUID,
  p_case_id UUID,
  p_title TEXT,
  p_body TEXT
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  member RECORD;
BEGIN
  FOR member IN
    SELECT user_id FROM organization_members WHERE organization_id = p_target_org_id
  LOOP
    INSERT INTO notifications (user_id, organization_id, case_id, type, title, body)
    VALUES (member.user_id, p_target_org_id, p_case_id, 'link_request', p_title, p_body);
  END LOOP;
END;
$$;

-- ── Aktif org yardımcısı ────────────────────────────────────────
CREATE OR REPLACE FUNCTION current_user_org()
RETURNS TABLE (org_id UUID, org_type org_type, org_name TEXT)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT p.active_organization_id, o.org_type, o.name
  FROM profiles p
  JOIN organizations o ON o.id = p.active_organization_id
  WHERE p.id = auth.uid();
END;
$$;

-- ── Bağlantı listesi (klinik veya lab tarafı) ───────────────────
CREATE OR REPLACE FUNCTION list_my_lab_links()
RETURNS TABLE (
  link_id UUID,
  clinic_org_id UUID,
  lab_org_id UUID,
  clinic_name TEXT,
  lab_name TEXT,
  status TEXT,
  requested_by_org_id UUID,
  request_note TEXT,
  created_at TIMESTAMPTZ,
  responded_at TIMESTAMPTZ
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id UUID;
BEGIN
  SELECT org_id INTO v_org_id FROM current_user_org() LIMIT 1;
  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'Aktif organizasyon yok';
  END IF;

  RETURN QUERY
  SELECT
    l.id,
    l.clinic_org_id,
    l.lab_org_id,
    c.name,
    lb.name,
    l.status,
    l.requested_by_org_id,
    l.request_note,
    l.created_at,
    l.responded_at
  FROM clinic_lab_links l
  JOIN organizations c ON c.id = l.clinic_org_id
  JOIN organizations lb ON lb.id = l.lab_org_id
  WHERE l.clinic_org_id = v_org_id OR l.lab_org_id = v_org_id
  ORDER BY
    CASE l.status WHEN 'active' THEN 0 WHEN 'pending' THEN 1 ELSE 2 END,
    l.created_at DESC;
END;
$$;

-- ── Lab arama (klinik için) ─────────────────────────────────────
CREATE OR REPLACE FUNCTION search_meshpack_labs(p_query TEXT DEFAULT '')
RETURNS TABLE (id UUID, name TEXT, has_link BOOLEAN, link_status TEXT)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id UUID;
  v_org_type org_type;
  v_q TEXT := trim(coalesce(p_query, ''));
BEGIN
  SELECT cu.org_id, cu.org_type INTO v_org_id, v_org_type FROM current_user_org() cu LIMIT 1;

  IF v_org_id IS NULL OR v_org_type != 'clinic' THEN
    RAISE EXCEPTION 'Sadece klinik hesabı lab arayabilir';
  END IF;

  RETURN QUERY
  SELECT
    o.id,
    o.name,
    EXISTS (
      SELECT 1 FROM clinic_lab_links l
      WHERE l.clinic_org_id = v_org_id AND l.lab_org_id = o.id
    ),
    (
      SELECT l.status FROM clinic_lab_links l
      WHERE l.clinic_org_id = v_org_id AND l.lab_org_id = o.id
      LIMIT 1
    )
  FROM organizations o
  WHERE o.org_type = 'lab'
    AND (v_q = '' OR o.name ILIKE '%' || v_q || '%')
  ORDER BY o.name
  LIMIT 50;
END;
$$;

-- ── Klinik arama (lab için) ─────────────────────────────────────
CREATE OR REPLACE FUNCTION search_meshpack_clinics(p_query TEXT DEFAULT '')
RETURNS TABLE (id UUID, name TEXT, has_link BOOLEAN, link_status TEXT)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id UUID;
  v_org_type org_type;
  v_q TEXT := trim(coalesce(p_query, ''));
BEGIN
  SELECT cu.org_id, cu.org_type INTO v_org_id, v_org_type FROM current_user_org() cu LIMIT 1;

  IF v_org_id IS NULL OR v_org_type != 'lab' THEN
    RAISE EXCEPTION 'Sadece lab hesabı klinik arayabilir';
  END IF;

  RETURN QUERY
  SELECT
    o.id,
    o.name,
    EXISTS (
      SELECT 1 FROM clinic_lab_links l
      WHERE l.lab_org_id = v_org_id AND l.clinic_org_id = o.id
    ),
    (
      SELECT l.status FROM clinic_lab_links l
      WHERE l.lab_org_id = v_org_id AND l.clinic_org_id = o.id
      LIMIT 1
    )
  FROM organizations o
  WHERE o.org_type = 'clinic'
    AND (v_q = '' OR o.name ILIKE '%' || v_q || '%')
  ORDER BY o.name
  LIMIT 50;
END;
$$;

-- ── Klinik → lab istek ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION request_lab_link(p_lab_org_id UUID, p_note TEXT DEFAULT '')
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_clinic_org_id UUID;
  v_clinic_name TEXT;
  v_lab_name TEXT;
  v_link_id UUID;
  v_existing TEXT;
BEGIN
  SELECT cu.org_id, cu.org_name INTO v_clinic_org_id, v_clinic_name
  FROM current_user_org() cu
  WHERE cu.org_type = 'clinic'
  LIMIT 1;

  IF v_clinic_org_id IS NULL THEN
    RAISE EXCEPTION 'Sadece klinik hesabı lab isteği gönderebilir';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM organizations WHERE id = p_lab_org_id AND org_type = 'lab') THEN
    RAISE EXCEPTION 'Geçersiz laboratuvar';
  END IF;

  SELECT status INTO v_existing
  FROM clinic_lab_links
  WHERE clinic_org_id = v_clinic_org_id AND lab_org_id = p_lab_org_id;

  IF v_existing = 'active' THEN
    RAISE EXCEPTION 'Bu laboratuvar zaten bağlı';
  END IF;
  IF v_existing = 'pending' THEN
    RAISE EXCEPTION 'Bu laboratuvara zaten bekleyen istek var';
  END IF;

  SELECT name INTO v_lab_name FROM organizations WHERE id = p_lab_org_id;

  INSERT INTO clinic_lab_links (clinic_org_id, lab_org_id, status, requested_by_org_id, request_note)
  VALUES (v_clinic_org_id, p_lab_org_id, 'pending', v_clinic_org_id, trim(coalesce(p_note, '')))
  ON CONFLICT (clinic_org_id, lab_org_id) DO UPDATE SET
    status = 'pending',
    requested_by_org_id = v_clinic_org_id,
    request_note = trim(coalesce(p_note, '')),
    responded_at = NULL
  RETURNING id INTO v_link_id;

  PERFORM notify_link_request(
    p_lab_org_id,
    NULL,
    'Yeni klinik bağlantı isteği',
    v_clinic_name || ' sizinle çalışmak istiyor.'
  );

  RETURN v_link_id;
END;
$$;

-- ── Lab → klinik istek (klinik kodu ile) ─────────────────────────
CREATE OR REPLACE FUNCTION request_clinic_link(p_clinic_pairing_code TEXT, p_note TEXT DEFAULT '')
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lab_org_id UUID;
  v_lab_name TEXT;
  v_clinic_org_id UUID;
  v_clinic_name TEXT;
  v_link_id UUID;
  v_existing TEXT;
BEGIN
  SELECT cu.org_id, cu.org_name INTO v_lab_org_id, v_lab_name
  FROM current_user_org() cu
  WHERE cu.org_type = 'lab'
  LIMIT 1;

  IF v_lab_org_id IS NULL THEN
    RAISE EXCEPTION 'Sadece lab hesabı klinik isteği gönderebilir';
  END IF;

  SELECT id, name INTO v_clinic_org_id, v_clinic_name
  FROM organizations
  WHERE upper(trim(pairing_code)) = upper(trim(p_clinic_pairing_code))
    AND org_type = 'clinic';

  IF v_clinic_org_id IS NULL THEN
    RAISE EXCEPTION 'Klinik bulunamadı — eşleştirme kodunu kontrol edin';
  END IF;

  SELECT status INTO v_existing
  FROM clinic_lab_links
  WHERE clinic_org_id = v_clinic_org_id AND lab_org_id = v_lab_org_id;

  IF v_existing = 'active' THEN
    RAISE EXCEPTION 'Bu klinik zaten bağlı';
  END IF;
  IF v_existing = 'pending' THEN
    RAISE EXCEPTION 'Bu kliniğe zaten bekleyen istek var';
  END IF;

  INSERT INTO clinic_lab_links (clinic_org_id, lab_org_id, status, requested_by_org_id, request_note)
  VALUES (v_clinic_org_id, v_lab_org_id, 'pending', v_lab_org_id, trim(coalesce(p_note, '')))
  ON CONFLICT (clinic_org_id, lab_org_id) DO UPDATE SET
    status = 'pending',
    requested_by_org_id = v_lab_org_id,
    request_note = trim(coalesce(p_note, '')),
    responded_at = NULL
  RETURNING id INTO v_link_id;

  PERFORM notify_link_request(
    v_clinic_org_id,
    NULL,
    'Yeni laboratuvar bağlantı isteği',
    v_lab_name || ' sizinle çalışmak istiyor.'
  );

  RETURN v_link_id;
END;
$$;

-- ── Lab → klinik istek (arama listesinden) ───────────────────────
CREATE OR REPLACE FUNCTION request_clinic_link_by_id(p_clinic_org_id UUID, p_note TEXT DEFAULT '')
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lab_org_id UUID;
  v_lab_name TEXT;
  v_clinic_name TEXT;
  v_link_id UUID;
  v_existing TEXT;
BEGIN
  SELECT cu.org_id, cu.org_name INTO v_lab_org_id, v_lab_name
  FROM current_user_org() cu
  WHERE cu.org_type = 'lab'
  LIMIT 1;

  IF v_lab_org_id IS NULL THEN
    RAISE EXCEPTION 'Sadece lab hesabı klinik isteği gönderebilir';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM organizations WHERE id = p_clinic_org_id AND org_type = 'clinic') THEN
    RAISE EXCEPTION 'Geçersiz klinik';
  END IF;

  SELECT status INTO v_existing
  FROM clinic_lab_links
  WHERE clinic_org_id = p_clinic_org_id AND lab_org_id = v_lab_org_id;

  IF v_existing = 'active' THEN
    RAISE EXCEPTION 'Bu klinik zaten bağlı';
  END IF;
  IF v_existing = 'pending' THEN
    RAISE EXCEPTION 'Bu kliniğe zaten bekleyen istek var';
  END IF;

  SELECT name INTO v_clinic_name FROM organizations WHERE id = p_clinic_org_id;

  INSERT INTO clinic_lab_links (clinic_org_id, lab_org_id, status, requested_by_org_id, request_note)
  VALUES (p_clinic_org_id, v_lab_org_id, 'pending', v_lab_org_id, trim(coalesce(p_note, '')))
  ON CONFLICT (clinic_org_id, lab_org_id) DO UPDATE SET
    status = 'pending',
    requested_by_org_id = v_lab_org_id,
    request_note = trim(coalesce(p_note, '')),
    responded_at = NULL
  RETURNING id INTO v_link_id;

  PERFORM notify_link_request(
    p_clinic_org_id,
    NULL,
    'Yeni laboratuvar bağlantı isteği',
    v_lab_name || ' sizinle çalışmak istiyor.'
  );

  RETURN v_link_id;
END;
$$;

-- ── İstek yanıtla (kabul / red) ─────────────────────────────────
CREATE OR REPLACE FUNCTION respond_lab_link(p_link_id UUID, p_accept BOOLEAN)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id UUID;
  v_link clinic_lab_links%ROWTYPE;
  v_responder_name TEXT;
  v_target_org_id UUID;
BEGIN
  SELECT org_id INTO v_org_id FROM current_user_org() LIMIT 1;
  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'Aktif organizasyon yok';
  END IF;

  SELECT * INTO v_link FROM clinic_lab_links WHERE id = p_link_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Bağlantı isteği bulunamadı';
  END IF;

  IF v_link.status != 'pending' THEN
    RAISE EXCEPTION 'Bu istek artık beklemiyor';
  END IF;

  -- Yanıtlayan: isteği göndermeyen taraf olmalı
  IF v_link.requested_by_org_id = v_org_id THEN
    RAISE EXCEPTION 'Kendi gönderdiğiniz isteği yanıtlayamazsınız';
  END IF;

  IF v_org_id NOT IN (v_link.clinic_org_id, v_link.lab_org_id) THEN
    RAISE EXCEPTION 'Bu isteği yanıtlama yetkiniz yok';
  END IF;

  SELECT name INTO v_responder_name FROM organizations WHERE id = v_org_id;

  IF p_accept THEN
    UPDATE clinic_lab_links
    SET status = 'active', responded_at = now()
    WHERE id = p_link_id;
    v_target_org_id := v_link.requested_by_org_id;
    PERFORM notify_link_request(
      v_target_org_id,
      NULL,
      'Bağlantı isteği kabul edildi',
      v_responder_name || ' isteğinizi kabul etti.'
    );
  ELSE
    UPDATE clinic_lab_links
    SET status = 'revoked', responded_at = now()
    WHERE id = p_link_id;
    v_target_org_id := v_link.requested_by_org_id;
    PERFORM notify_link_request(
      v_target_org_id,
      NULL,
      'Bağlantı isteği reddedildi',
      v_responder_name || ' isteğinizi reddetti.'
    );
  END IF;

  RETURN p_link_id;
END;
$$;

-- ── Bağlantıyı kes ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION revoke_lab_link(p_link_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id UUID;
  v_link clinic_lab_links%ROWTYPE;
BEGIN
  SELECT org_id INTO v_org_id FROM current_user_org() LIMIT 1;
  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'Aktif organizasyon yok';
  END IF;

  SELECT * INTO v_link FROM clinic_lab_links WHERE id = p_link_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Bağlantı bulunamadı';
  END IF;

  IF v_org_id NOT IN (v_link.clinic_org_id, v_link.lab_org_id) THEN
    RAISE EXCEPTION 'Bu bağlantıyı kesme yetkiniz yok';
  END IF;

  UPDATE clinic_lab_links SET status = 'revoked', responded_at = now() WHERE id = p_link_id;
  RETURN p_link_id;
END;
$$;

-- ── Kod ile anında bağlan (güncelle: requested_by kaydı) ────────
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

  INSERT INTO clinic_lab_links (clinic_org_id, lab_org_id, status, requested_by_org_id, responded_at)
  VALUES (v_clinic_org_id, v_lab_org_id, 'active', v_clinic_org_id, now())
  ON CONFLICT (clinic_org_id, lab_org_id) DO UPDATE SET
    status = 'active',
    requested_by_org_id = v_clinic_org_id,
    responded_at = now();

  RETURN v_lab_org_id;
END;
$$;

REVOKE ALL ON FUNCTION list_my_lab_links() FROM PUBLIC;
REVOKE ALL ON FUNCTION search_meshpack_labs(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION search_meshpack_clinics(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION request_lab_link(UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION request_clinic_link(TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION request_clinic_link_by_id(UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION respond_lab_link(UUID, BOOLEAN) FROM PUBLIC;
REVOKE ALL ON FUNCTION revoke_lab_link(UUID) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION list_my_lab_links() TO authenticated;
GRANT EXECUTE ON FUNCTION search_meshpack_labs(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION search_meshpack_clinics(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION request_lab_link(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION request_clinic_link(TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION request_clinic_link_by_id(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION respond_lab_link(UUID, BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION revoke_lab_link(UUID) TO authenticated;
