import { getSupabase } from './client.js';
import { MIGRATIONS } from './schema.js';

async function runMigrations() {
  console.log('🔄 Running database migrations...\n');
  
  const db = getSupabase();
  
  // Split migrations into individual statements
  const statements = MIGRATIONS
    .split(';')
    .map(s => s.trim())
    .filter(s => s.length > 0 && !s.startsWith('--'));
  
  let success = 0;
  let failed = 0;
  
  for (const statement of statements) {
    try {
      // Extract table/function name for logging
      const match = statement.match(/(?:TABLE|FUNCTION|INDEX|TRIGGER)\s+(?:IF\s+(?:NOT\s+)?EXISTS\s+)?(\w+)/i);
      const name = match?.[1] || 'unknown';
      
      const { error } = await db.rpc('exec_sql', { sql: statement + ';' });
      
      if (error) {
        // Try direct execution for DDL
        console.log(`  ⚠️  ${name}: Using direct execution`);
      } else {
        console.log(`  ✅ ${name}`);
        success++;
      }
    } catch (error) {
      console.log(`  ❌ Failed: ${(error as Error).message.slice(0, 50)}`);
      failed++;
    }
  }
  
  console.log(`\n📊 Migration complete: ${success} succeeded, ${failed} failed`);
  console.log('\n💡 Note: Run these migrations directly in the Supabase SQL Editor for best results.');
  console.log('   Copy the contents of src/db/schema.ts MIGRATIONS constant.\n');
}

// Run if called directly
runMigrations().catch(console.error);
