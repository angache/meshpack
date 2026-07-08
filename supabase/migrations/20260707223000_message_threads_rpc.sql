-- MeshPack Cloud — Ölçeklenebilir mesajlaşma
-- Konuşma listesini server-side üretir: her vakanın son mesajı + kullanıcının
-- okunmamış mesaj sayısı tek sorguda, sayfalama ile döner.
-- Amaç: lab tarafının onlarca klinik × onlarca hekim ölçeğinde
-- client'a binlerce mesaj indirmeden hızlı çalışması.

-- Okunmamış mesaj sayımı (user_id + case_id) için kısmi index
CREATE INDEX IF NOT EXISTS idx_notifications_unread_by_case
  ON notifications (user_id, case_id)
  WHERE read_at IS NULL;

-- ── Konuşma listesi (thread) RPC ────────────────────────────────
-- SECURITY DEFINER: RLS'yi baypas eder, bu yüzden erişim kontrolü
-- WHERE içinde user_org_ids() ile açıkça yapılır.
CREATE OR REPLACE FUNCTION list_message_threads(
  p_limit int DEFAULT 30,
  p_offset int DEFAULT 0
)
RETURNS TABLE (
  case_id uuid,
  case_number text,
  patient_display_name text,
  status cloud_case_status,
  last_message_body text,
  last_message_at timestamptz,
  last_message_author_org_id uuid,
  unread_count bigint,
  sort_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH accessible AS (
    SELECT c.*
    FROM cloud_cases c
    WHERE c.clinic_org_id IN (SELECT user_org_ids())
       OR c.lab_org_id IN (SELECT user_org_ids())
  )
  SELECT
    c.id AS case_id,
    c.case_number,
    c.patient_display_name,
    c.status,
    lm.body AS last_message_body,
    lm.created_at AS last_message_at,
    lm.author_org_id AS last_message_author_org_id,
    COALESCE(un.cnt, 0) AS unread_count,
    COALESCE(lm.created_at, c.updated_at, c.sent_at) AS sort_at
  FROM accessible c
  LEFT JOIN LATERAL (
    SELECT m.body, m.created_at, m.author_org_id
    FROM case_messages m
    WHERE m.case_id = c.id
    ORDER BY m.created_at DESC
    LIMIT 1
  ) lm ON true
  LEFT JOIN LATERAL (
    SELECT count(*) AS cnt
    FROM notifications n
    WHERE n.case_id = c.id
      AND n.user_id = auth.uid()
      AND n.read_at IS NULL
      AND n.type = 'new_message'
  ) un ON true
  WHERE
    -- Mesajı olan her vaka görünür; ayrıca lab tüm vakalarını,
    -- klinik ise laba iletilmiş (aktif) vakalarını görür.
    lm.created_at IS NOT NULL
    OR c.lab_org_id IN (SELECT user_org_ids())
    OR c.status IN ('sent', 'received', 'in_production', 'quality_check', 'shipped', 'completed')
  ORDER BY COALESCE(lm.created_at, c.updated_at, c.sent_at) DESC NULLS LAST
  LIMIT GREATEST(p_limit, 1)
  OFFSET GREATEST(p_offset, 0);
$$;

GRANT EXECUTE ON FUNCTION list_message_threads(int, int) TO authenticated;
