import { supabase } from './supabase.js';

const { data, error } = await supabase
  .from('users')
  .select('*');

console.log('DATA:', data);
console.log('ERROR:', error);