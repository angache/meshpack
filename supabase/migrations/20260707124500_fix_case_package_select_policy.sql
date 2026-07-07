-- MeshPack Cloud: case-packages SELECT policy fix
-- Amaç: Lab kullanıcıları, klinik klasörü altında olsa bile
-- kendi erişebildikleri cloud_cases kaydına ait ZIP'i okuyabilsin.

DROP POLICY IF EXISTS case_packages_select ON storage.objects;

CREATE POLICY case_packages_select ON storage.objects
FOR SELECT
USING (
  bucket_id = 'case-packages'
  AND (
    -- Eski davranış: obje ilk klasörü kullanıcının org id'si ise erişim.
    (storage.foldername(name))[1] IN (
      SELECT id::text FROM organizations WHERE id IN (SELECT user_org_ids())
    )
    OR
    -- Yeni davranış: obje, kullanıcının erişebildiği bir cloud_cases.package_storage_path ile eşleşiyorsa erişim.
    EXISTS (
      SELECT 1
      FROM cloud_cases c
      WHERE
        (
          c.clinic_org_id IN (SELECT user_org_ids())
          OR c.lab_org_id IN (SELECT user_org_ids())
        )
        AND regexp_replace(
              regexp_replace(
                regexp_replace(
                  regexp_replace(coalesce(c.package_storage_path, ''), '\?.*$', ''),
                  '^https?://[^/]+/', ''
                ),
                '^/?storage/v1/object/(?:(?:public|sign|authenticated)/)?[^/]+/', ''
              ),
              '^/?case-packages/', ''
            ) = storage.objects.name
    )
  )
);

