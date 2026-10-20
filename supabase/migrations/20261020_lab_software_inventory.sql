-- Catálogo estruturado de softwares instalados por laboratório.
-- Cada item usa o formato: {"name": "Nome do software", "version": "Versão"}.

alter table public.labs
  add column if not exists software_inventory jsonb not null default '[]'::jsonb;

alter table public.labs
  drop constraint if exists labs_software_inventory_check;

alter table public.labs
  add constraint labs_software_inventory_check check (
    jsonb_typeof(software_inventory) = 'array'
    and jsonb_array_length(software_inventory) <= 1000
  );

comment on column public.labs.software_inventory is
  'Lista pública de softwares instalados. Cada item contém name e version.';
