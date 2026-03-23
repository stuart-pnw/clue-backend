import Anthropic from '@anthropic-ai/sdk';
import { env } from '../lib/env.js';
import { getSavedClues, getUserPreferences } from '../db/client.js';
import type { SavedClue } from '../db/schema.js';

const anthropic = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });

// ============================================
// TYPES
// ============================================

export interface LearnMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface LearnResponse {
  message: string;
  suggestions: string[];
}

// ============================================
// BUILD CONTEXT FROM SAVED CLUES
// ============================================

function buildClueContext(clues: SavedClue[]): string {
  if (clues.length === 0) return '';
  
  const recentClues = clues.slice(0, 20); // Last 20 saved clues
  
  const cluesSummary = recentClues.map(sc => {
    const c = sc.clue;
    let summary = `- [${c.topic}] `;
    
    if (c.type === 'quote') {
      summary += `Quote: "${c.quote}" - ${c.author}`;
    } else if (c.type === 'stat') {
      summary += `Stat: ${c.stat} ${c.title}`;
    } else {
      summary += c.title || c.detail.slice(0, 100);
    }
    
    return summary;
  }).join('\n');
  
  return `
The user has saved these clues (insights from their professional network):

${cluesSummary}

Use this context to provide personalized, relevant answers. Reference specific clues when relevant.
`;
}

// ============================================
// GENERATE SMART SUGGESTIONS
// ============================================

export async function generateSuggestions(userId: string): Promise<string[]> {
  const savedClues = await getSavedClues(userId);
  const prefs = await getUserPreferences(userId);
  
  if (savedClues.length === 0) {
    // Default suggestions for new users
    return [
      "What are the biggest AI trends right now?",
      "How can I stay ahead in my industry?",
      "What should I know about AI agents?",
    ];
  }
  
  // Get recent topics
  const topics = [...new Set(savedClues.slice(0, 10).map(c => c.clue.topic))];
  const professions = prefs?.professions || [];
  
  const prompt = `Based on these topics the user is interested in: ${topics.join(', ')}
And their profession(s): ${professions.join(', ') || 'general professional'}

Generate 3 short, specific questions they might want to ask. Make them actionable and relevant.
Return as JSON array of strings only: ["question 1", "question 2", "question 3"]`;

  try {
    const response = await anthropic.messages.create({
      model: 'claude-3-5-haiku-20241022',
      max_tokens: 256,
      messages: [{ role: 'user', content: prompt }],
    });
    
    const text = response.content[0].type === 'text' ? response.content[0].text : '';
    const match = text.match(/\[[\s\S]*\]/);
    if (match) {
      return JSON.parse(match[0]);
    }
  } catch (error) {
    console.error('[Learn] Suggestion generation error:', error);
  }
  
  // Fallback suggestions based on topics
  return topics.slice(0, 3).map(topic => `What's the latest on ${topic}?`);
}

// ============================================
// CHAT WITH CONTEXT
// ============================================

export async function chat(
  userId: string,
  messages: LearnMessage[],
  clueIds?: string[]
): Promise<LearnResponse> {
  // Get user's saved clues for context
  const savedClues = await getSavedClues(userId);
  const prefs = await getUserPreferences(userId);
  
  // If specific clues referenced, prioritize those
  let contextClues = savedClues;
  if (clueIds && clueIds.length > 0) {
    const referenced = savedClues.filter(c => clueIds.includes(c.id));
    const others = savedClues.filter(c => !clueIds.includes(c.id));
    contextClues = [...referenced, ...others];
  }
  
  const clueContext = buildClueContext(contextClues);
  
  const systemPrompt = `You are a knowledgeable AI assistant in the Clue app - a professional intelligence tool that helps people stay ahead by synthesizing insights from their network.

${clueContext}

User's profession(s): ${prefs?.professions?.join(', ') || 'Not specified'}
User's goal: ${prefs?.goal || 'Stay informed'}

Guidelines:
- Be concise but thorough
- Reference the user's saved clues when relevant
- Provide actionable insights
- If asked about something outside your knowledge, say so
- Keep responses focused and professional
- Use bullet points sparingly, prefer flowing prose`;

  try {
    const response = await anthropic.messages.create({
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 1024,
      system: systemPrompt,
      messages: messages.map(m => ({
        role: m.role,
        content: m.content,
      })),
    });
    
    const assistantMessage = response.content[0].type === 'text' 
      ? response.content[0].text 
      : '';
    
    // Generate follow-up suggestions based on the conversation
    const suggestions = await generateFollowUps(messages, assistantMessage);
    
    return {
      message: assistantMessage,
      suggestions,
    };
    
  } catch (error) {
    console.error('[Learn] Chat error:', error);
    throw new Error('Failed to generate response');
  }
}

// ============================================
// GENERATE FOLLOW-UP SUGGESTIONS
// ============================================

async function generateFollowUps(
  messages: LearnMessage[],
  lastResponse: string
): Promise<string[]> {
  const lastUserMessage = messages.filter(m => m.role === 'user').pop()?.content || '';
  
  const prompt = `Based on this conversation:
User asked: "${lastUserMessage.slice(0, 200)}"
Assistant answered: "${lastResponse.slice(0, 300)}"

Generate 2 natural follow-up questions the user might ask. Short and specific.
Return as JSON array: ["question 1", "question 2"]`;

  try {
    const response = await anthropic.messages.create({
      model: 'claude-3-5-haiku-20241022',
      max_tokens: 128,
      messages: [{ role: 'user', content: prompt }],
    });
    
    const text = response.content[0].type === 'text' ? response.content[0].text : '';
    const match = text.match(/\[[\s\S]*\]/);
    if (match) {
      return JSON.parse(match[0]);
    }
  } catch (error) {
    console.error('[Learn] Follow-up generation error:', error);
  }
  
  return ["Tell me more", "What else should I know?"];
}

// ============================================
// DEEP DIVE ON A CLUE
// ============================================

export async function deepDive(
  userId: string,
  clueId: string
): Promise<LearnResponse> {
  const savedClues = await getSavedClues(userId);
  const clue = savedClues.find(c => c.id === clueId);
  
  if (!clue) {
    throw new Error('Clue not found');
  }
  
  const c = clue.clue;
  
  const prompt = `Provide a comprehensive deep-dive on this topic:

Topic: ${c.topic}
${c.title ? `Title: ${c.title}` : ''}
${c.quote ? `Quote: "${c.quote}" - ${c.author}` : ''}
${c.stat ? `Stat: ${c.stat} ${c.stat_label || ''}` : ''}
Detail: ${c.detail}
Sources: ${c.sources.map(s => s.handle).join(', ')}

Give me:
1. Why this matters (2-3 sentences)
2. Key context I should know
3. What to watch for next
4. How this might affect my work

Keep it actionable and concise.`;

  const messages: LearnMessage[] = [{ role: 'user', content: prompt }];
  
  return chat(userId, messages, [clueId]);
}
