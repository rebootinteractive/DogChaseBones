// Per-prototype namespace. Each cloned prototype sets this once.
export const PROTOTYPE = 'dog-chase-bones';

export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL ?? '';
export const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY ?? '';

// True only when both env vars are present. Until this prototype gets a Supabase
// project, levels live in the repo: builtin + anything committed under
// src/levels/published/, with the editor keeping drafts in localStorage.
export const HAS_BACKEND = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
