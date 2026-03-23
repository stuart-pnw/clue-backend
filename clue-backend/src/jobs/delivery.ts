import { getUsersByDeliveryTime, getDailyClues, saveDailyClues, markCluesDelivered, getDeviceTokens } from '../db/client.js';
import { fetchNetworkActivity } from '../services/x-api.js';
import { generateDailyClues } from '../services/clue-generator.js';
import { sendPushNotification } from '../services/push.js';

// ============================================
// GENERATE & DELIVER CLUES
// ============================================

export async function generateCluesForCohort(
  deliveryTime: '6am' | '7am' | '8am' | '9am',
  timezone: string
): Promise<void> {
  console.log(`[Delivery Job] Starting for ${deliveryTime} ${timezone}`);
  
  const users = await getUsersByDeliveryTime(deliveryTime, timezone);
  console.log(`[Delivery Job] Found ${users.length} users`);
  
  const today = new Date().toISOString().split('T')[0];
  
  for (const user of users) {
    try {
      // Check if already generated
      const existing = await getDailyClues(user.id, today);
      if (existing && existing.clues.length > 0 && existing.delivered_at) {
        console.log(`[Delivery Job] User ${user.id} already delivered`);
        continue;
      }
      
      // Fetch network activity
      console.log(`[Delivery Job] Fetching network for user ${user.id}`);
      const rankedTweets = await fetchNetworkActivity(user.id);
      
      if (rankedTweets.length === 0) {
        console.log(`[Delivery Job] No tweets for user ${user.id}`);
        continue;
      }
      
      // Generate clues
      const clues = await generateDailyClues(user.id, rankedTweets, 3);
      
      if (clues.length === 0) {
        console.log(`[Delivery Job] No clues generated for user ${user.id}`);
        continue;
      }
      
      // Save clues
      await saveDailyClues(user.id, today, clues);
      await markCluesDelivered(user.id, today);
      
      // Send push notification
      const tokens = await getDeviceTokens(user.id);
      for (const deviceToken of tokens) {
        await sendPushNotification(deviceToken.token, {
          title: 'Your clues are ready ☀️',
          body: `${clues.length} insights from your network`,
          data: { type: 'daily_clues' },
        });
      }
      
      console.log(`[Delivery Job] Delivered ${clues.length} clues to user ${user.id}`);
      
    } catch (error) {
      console.error(`[Delivery Job] Error for user ${user.id}:`, error);
    }
  }
  
  console.log('[Delivery Job] Complete');
}

// ============================================
// DELIVERY SCHEDULER
// ============================================

const TIMEZONE_COHORTS = [
  'America/Los_Angeles',
  'America/Denver',
  'America/Chicago',
  'America/New_York',
  'Europe/London',
  'Europe/Paris',
  'Asia/Tokyo',
  'Asia/Shanghai',
  'Australia/Sydney',
];

function getHourInTimezone(timezone: string): number {
  const hour = new Date().toLocaleString('en-US', {
    timeZone: timezone,
    hour: 'numeric',
    hour12: false,
  });
  return parseInt(hour, 10);
}

const deliveryHours: Record<string, number> = {
  '6am': 6,
  '7am': 7,
  '8am': 8,
  '9am': 9,
};

export function startDeliveryScheduler(): void {
  console.log('[Delivery Scheduler] Starting...');
  
  // Check every 15 minutes
  setInterval(async () => {
    for (const timezone of TIMEZONE_COHORTS) {
      const hour = getHourInTimezone(timezone);
      
      for (const [deliveryTime, deliveryHour] of Object.entries(deliveryHours)) {
        if (hour === deliveryHour) {
          await generateCluesForCohort(
            deliveryTime as '6am' | '7am' | '8am' | '9am',
            timezone
          );
        }
      }
    }
  }, 15 * 60 * 1000); // Every 15 minutes
  
  console.log('[Delivery Scheduler] Started');
}
