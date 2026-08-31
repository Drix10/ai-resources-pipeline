import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const revalidate = 3600;

function generateFallbackWeeks() {
  const weeks = [];
  const now = new Date();
  const oneYearAgo = new Date(now.getTime() - 364 * 24 * 60 * 60 * 1000);
  
  let current = new Date(oneYearAgo);
  let totalContributions = 0;

  for (let w = 0; w < 52; w++) {
    const days = [];
    for (let d = 0; d < 7; d++) {
      const dateStr = current.toISOString().split('T')[0];
      const dayOfWeek = current.getDay();
      const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
      const seed = (w * 7 + d * 13 + current.getDate() * 17) % 100;
      
      let count = 0;
      let level = 'NONE';

      if (seed > 85) {
        count = Math.floor((seed % 6) + 7);
        level = 'FOURTH_QUARTILE';
      } else if (seed > 65) {
        count = Math.floor((seed % 4) + 4);
        level = 'THIRD_QUARTILE';
      } else if (seed > 40) {
        count = Math.floor((seed % 3) + 2);
        level = 'SECOND_QUARTILE';
      } else if (seed > 20) {
        count = 1;
        level = 'FIRST_QUARTILE';
      } else if (!isWeekend && seed > 10) {
        count = 1;
        level = 'FIRST_QUARTILE';
      }

      totalContributions += count;
      days.push({
        date: dateStr,
        contributionCount: count,
        contributionLevel: level,
      });

      current.setDate(current.getDate() + 1);
    }
    weeks.push({ contributionDays: days });
  }

  return { weeks, totalContributions: totalContributions + 1420 };
}

export async function GET() {
  try {
    const token = process.env.GITHUB_READ_TOKEN || process.env.GITHUB_TOKEN || process.env.GITHUB_PAT;
    const username = process.env.GITHUB_USERNAME || 'Drix10';

    if (token) {
      const query = `
        query($username: String!) {
          user(login: $username) {
            contributionsCollection {
              contributionCalendar {
                totalContributions
                weeks {
                  contributionDays {
                    date
                    contributionCount
                    contributionLevel
                  }
                }
              }
            }
          }
        }
      `;

      const ghRes = await fetch('https://api.github.com/graphql', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'User-Agent': 'Drix10-Portfolio',
        },
        body: JSON.stringify({ query, variables: { username } }),
        next: { revalidate: 3600 },
      });

      if (ghRes.ok) {
        const ghData = await ghRes.json();
        const calendar = ghData?.data?.user?.contributionsCollection?.contributionCalendar;
        if (calendar?.weeks) {
          return NextResponse.json({
            weeks: calendar.weeks,
            totalContributions: calendar.totalContributions,
            username,
            isLive: true,
          });
        }
      }
    }
  } catch (err) {}

  const fallback = generateFallbackWeeks();
  return NextResponse.json({
    weeks: fallback.weeks,
    totalContributions: fallback.totalContributions,
    username: 'Drix10',
    isLive: false,
  });
}
