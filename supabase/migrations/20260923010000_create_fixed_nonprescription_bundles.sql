CREATE TABLE IF NOT EXISTS public.promo_bundles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), cabang_id text NOT NULL,
  name text NOT NULL, code text NOT NULL, description text NOT NULL DEFAULT '',
  bundle_price numeric NOT NULL CHECK (bundle_price >= 0), starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL, status text NOT NULL DEFAULT 'DRAFT',
  created_by text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(cabang_id, code), CHECK(ends_at >= starts_at)
);
CREATE TABLE IF NOT EXISTS public.promo_bundle_items (
  bundle_id uuid NOT NULL REFERENCES public.promo_bundles(id) ON DELETE CASCADE,
  kode_obat text NOT NULL REFERENCES public.master_barang(kode_obat), qty numeric NOT NULL DEFAULT 1 CHECK(qty > 0),
  PRIMARY KEY(bundle_id, kode_obat)
);
ALTER TABLE public.trx_penjualan ADD COLUMN IF NOT EXISTS bundle_id uuid REFERENCES public.promo_bundles(id);
ALTER TABLE public.trx_penjualan ADD COLUMN IF NOT EXISTS bundle_code text;
ALTER TABLE public.trx_penjualan ADD COLUMN IF NOT EXISTS bundle_discount numeric NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS promo_bundles_branch_status_idx ON public.promo_bundles(cabang_id,status,starts_at,ends_at);
CREATE INDEX IF NOT EXISTS promo_bundle_items_sku_idx ON public.promo_bundle_items(kode_obat);
