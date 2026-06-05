import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://momigbtnsswoldqnadmc.supabase.co';
// Fallback JWT para evitar erro "supabaseKey is required" durante o build estático do Next.js
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1vbWlnYnRuc3N3b2xkcW5hZG1jIiwicm9sZSI6ImFub24iLCJpYXQiOjE3MTcyOTkyMDAsImV4cCI6MjAzMjg3NTIwMH0.mock_key';

// Inicialização do cliente Supabase
export const supabase = createClient(supabaseUrl, supabaseAnonKey);
