import { Hono } from 'hono';
import { verifyToken, extractToken } from '../lib/jwt.js';
import { 
  createShare, 
  trackClick, 
  getShareStats, 
  getClueSocialProof,
  checkShareToUnlock,
} from '../services/shares.js';

const shares = new Hono();

// ============================================
// TRACK SHARE (authenticated)
// ============================================

shares.post('/:clueId', async (c) => {
  const token = extractToken(c.req.header('Authorization'));
  if (!token) return c.json({ error: 'Unauthorized' }, 401);
  
  const payload = await verifyToken(token);
  if (!payload) return c.json({ error: 'Invalid token' }, 401);
  
  const clueId = c.req.param('clueId');
  const body = await c.req.json<{ platform: 'x' | 'linkedin' | 'copy' | 'other' }>();
  
  try {
    const share = await createShare(payload.sub, clueId, body.platform || 'other');
    
    // Check if user unlocked bonus
    const bonus = await checkShareToUnlock(payload.sub);
    
    return c.json({ 
      share,
      share_link: share.share_link,
      bonus_unlocked: bonus.eligible,
      bonus_clues: bonus.eligible ? bonus.bonus_clues : 0,
    });
  } catch (error) {
    console.error('[Shares] Create error:', error);
    return c.json({ error: 'Failed to create share' }, 500);
  }
});

// ============================================
// TRACK CLICK (public)
// ============================================

shares.get('/click/:shareId', async (c) => {
  const shareId = c.req.param('shareId');
  
  try {
    await trackClick(shareId);
    
    // Redirect to app or clue page
    return c.redirect(`https://clue.app/view/${shareId}`);
  } catch (error) {
    console.error('[Shares] Click error:', error);
    return c.redirect('https://clue.app');
  }
});

// ============================================
// GET SHARE STATS (authenticated)
// ============================================

shares.get('/stats', async (c) => {
  const token = extractToken(c.req.header('Authorization'));
  if (!token) return c.json({ error: 'Unauthorized' }, 401);
  
  const payload = await verifyToken(token);
  if (!payload) return c.json({ error: 'Invalid token' }, 401);
  
  try {
    const stats = await getShareStats(payload.sub);
    const bonus = await checkShareToUnlock(payload.sub);
    
    return c.json({ 
      ...stats,
      share_to_unlock: bonus,
    });
  } catch (error) {
    console.error('[Shares] Stats error:', error);
    return c.json({ error: 'Failed to get stats' }, 500);
  }
});

// ============================================
// GET SOCIAL PROOF FOR CLUE (public)
// ============================================

shares.get('/proof/:clueId', async (c) => {
  const clueId = c.req.param('clueId');
  
  try {
    const proof = await getClueSocialProof(clueId);
    return c.json(proof);
  } catch (error) {
    console.error('[Shares] Proof error:', error);
    return c.json({ saves: 0, shares: 0 });
  }
});

export default shares;
