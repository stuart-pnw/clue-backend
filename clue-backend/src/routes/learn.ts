import { Hono } from 'hono';
import { verifyToken, extractToken } from '../lib/jwt.js';
import { getSupabase } from '../db/client.js';
import { chat, generateSuggestions, deepDive, LearnMessage } from '../services/learn.js';

const learn = new Hono();

// Auth middleware
learn.use('*', async (c, next) => {
  const token = extractToken(c.req.header('Authorization'));
  if (!token) return c.json({ error: 'Unauthorized' }, 401);
  
  const payload = await verifyToken(token);
  if (!payload) return c.json({ error: 'Invalid token' }, 401);
  
  c.set('userId', payload.sub);
  await next();
});

// ============================================
// ASK (Main chat endpoint)
// ============================================

learn.post('/ask', async (c) => {
  const userId = c.get('userId');
  const body = await c.req.json<{
    message: string;
    conversation_id?: string;
    clue_ids?: string[];
  }>();
  
  if (!body.message || body.message.trim().length === 0) {
    return c.json({ error: 'Message required' }, 400);
  }
  
  const db = getSupabase();
  let conversationId = body.conversation_id;
  let messages: LearnMessage[] = [];
  
  // Get or create conversation
  if (conversationId) {
    // Fetch existing messages
    const { data: existingMessages } = await db
      .from('learn_messages')
      .select('role, content')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: true });
    
    if (existingMessages) {
      messages = existingMessages as LearnMessage[];
    }
  } else {
    // Create new conversation
    const { data: conversation, error } = await db
      .from('learn_conversations')
      .insert({
        user_id: userId,
        context_clue_ids: body.clue_ids || [],
      })
      .select()
      .single();
    
    if (error) throw error;
    conversationId = conversation.id;
  }
  
  // Add user message
  messages.push({ role: 'user', content: body.message });
  
  // Save user message
  await db.from('learn_messages').insert({
    conversation_id: conversationId,
    role: 'user',
    content: body.message,
  });
  
  try {
    // Generate response
    const response = await chat(userId, messages, body.clue_ids);
    
    // Save assistant message
    await db.from('learn_messages').insert({
      conversation_id: conversationId,
      role: 'assistant',
      content: response.message,
    });
    
    // Update conversation timestamp
    await db
      .from('learn_conversations')
      .update({ last_message_at: new Date().toISOString() })
      .eq('id', conversationId);
    
    return c.json({
      conversation_id: conversationId,
      message: response.message,
      suggestions: response.suggestions,
    });
    
  } catch (error) {
    console.error('[Learn] Ask error:', error);
    return c.json({ error: 'Failed to generate response' }, 500);
  }
});

// ============================================
// GET SUGGESTIONS
// ============================================

learn.get('/suggestions', async (c) => {
  const userId = c.get('userId');
  
  try {
    const suggestions = await generateSuggestions(userId);
    return c.json({ suggestions });
  } catch (error) {
    console.error('[Learn] Suggestions error:', error);
    return c.json({ suggestions: [
      "What should I know about AI today?",
      "What are the key trends in my industry?",
      "How can I use what I've learned?",
    ]});
  }
});

// ============================================
// DEEP DIVE ON CLUE
// ============================================

learn.post('/deep-dive/:clueId', async (c) => {
  const userId = c.get('userId');
  const clueId = c.req.param('clueId');
  
  try {
    const response = await deepDive(userId, clueId);
    return c.json(response);
  } catch (error) {
    console.error('[Learn] Deep dive error:', error);
    return c.json({ error: 'Failed to generate deep dive' }, 500);
  }
});

// ============================================
// CONVERSATION HISTORY
// ============================================

learn.get('/history', async (c) => {
  const userId = c.get('userId');
  const db = getSupabase();
  
  const { data: conversations, error } = await db
    .from('learn_conversations')
    .select(`
      id,
      started_at,
      last_message_at,
      context_clue_ids,
      learn_messages (
        role,
        content,
        created_at
      )
    `)
    .eq('user_id', userId)
    .order('last_message_at', { ascending: false })
    .limit(20);
  
  if (error) {
    console.error('[Learn] History error:', error);
    return c.json({ error: 'Failed to fetch history' }, 500);
  }
  
  // Format conversations with preview
  const formatted = conversations?.map(conv => ({
    id: conv.id,
    started_at: conv.started_at,
    last_message_at: conv.last_message_at,
    preview: (conv.learn_messages as any[])?.[0]?.content?.slice(0, 100) || '',
    message_count: (conv.learn_messages as any[])?.length || 0,
  }));
  
  return c.json({ conversations: formatted });
});

// ============================================
// GET SINGLE CONVERSATION
// ============================================

learn.get('/conversation/:id', async (c) => {
  const userId = c.get('userId');
  const conversationId = c.req.param('id');
  const db = getSupabase();
  
  const { data: conversation, error } = await db
    .from('learn_conversations')
    .select(`
      id,
      started_at,
      context_clue_ids,
      learn_messages (
        id,
        role,
        content,
        created_at
      )
    `)
    .eq('id', conversationId)
    .eq('user_id', userId)
    .single();
  
  if (error || !conversation) {
    return c.json({ error: 'Conversation not found' }, 404);
  }
  
  return c.json({ conversation });
});

// ============================================
// DELETE CONVERSATION
// ============================================

learn.delete('/conversation/:id', async (c) => {
  const userId = c.get('userId');
  const conversationId = c.req.param('id');
  const db = getSupabase();
  
  // Messages will be deleted via cascade
  const { error } = await db
    .from('learn_conversations')
    .delete()
    .eq('id', conversationId)
    .eq('user_id', userId);
  
  if (error) {
    return c.json({ error: 'Failed to delete conversation' }, 500);
  }
  
  return c.json({ success: true });
});

export default learn;
