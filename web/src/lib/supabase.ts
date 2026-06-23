import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://ncjywndaumhehfmrqfuq.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_ejtk6k6tTM8J0IslJJVkTQ_m_WeEvSt";

export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
