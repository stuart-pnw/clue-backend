import { Hono } from 'hono';
import { verifyToken, extractToken } from '../lib/jwt.js';
import { getUserAchievements, checkNewAchievements, ACHIEVEMENTS } from '../services/achievements.js';

const achievements = new Hono();

// Auth middleware
achievements.use('*', async (c, next) => {
  const token = extractToken(c.req.header('Authorization'));
  if (!token) return c.json({ error: 'Unauthorized' }, 401);
  
  const payload = await verifyToken(token);
  if (!payload) return c.json({ error: 'Invalid token' }, 401);
  
  c.set('userId', payload.sub);
  await next();
});

// ============================================
// GET ALL ACHIEVEMENTS
// ============================================

achievements.get('/', async (c) => {
  const userId = c.get('userId');
  
  try {
    const userAchievements = await getUserAchievements(userId);
    
    // Group by category
    const byCategory = {
      streak: userAchievements.filter(a => a.category === 'streak'),
      engagement: userAchievements.filter(a => a.category === 'engagement'),
      social: userAchievements.filter(a => a.category === 'social'),
      learning: userAchievements.filter(a => a.category === 'learning'),
    };
    
    const unlocked = userAchievements.filter(a => a.unlocked).length;
    const total = userAchievements.length;
    
    return c.json({
      achievements: userAchievements,
      by_category: byCategory,
      stats: {
        unlocked,
        total,
        percentage: Math.round((unlocked / total) * 100),
      },
    });
  } catch (error) {
    console.error('[Achievements] Error:', error);
    return c.json({ error: 'Failed to get achievements' }, 500);
  }
});

// ============================================
// CHECK FOR NEW ACHIEVEMENTS
// ============================================

achievements.get('/check', async (c) => {
  const userId = c.get('userId');
  
  try {
    const newAchievements = await checkNewAchievements(userId);
    return c.json({ 
      new_achievements: newAchievements,
      has_new: newAchievements.length > 0,
    });
  } catch (error) {
    console.error('[Achievements] Check error:', error);
    return c.json({ error: 'Failed to check achievements' }, 500);
  }
});

// ============================================
// GET ACHIEVEMENT DEFINITIONS (public)
// ============================================

achievements.get('/definitions', (c) => {
  return c.json({
    achievements: ACHIEVEMENTS.map(a => ({
      id: a.id,
      name: a.name,
      description: a.description,
      emoji: a.emoji,
      category: a.category,
      requirement: a.requirement,
    })),
  });
});

export default achievements;
