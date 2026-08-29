#!/usr/bin/env node

/**
 * import-resources.js
 *
 * Connects to the GitHub repository (Drix10/ai-resources), recursively discovers
 * all markdown curation files across all topic folders, and imports them locally
 * so the Next.js Knowledge Hub blog can instantly index and render every single article.
 */

const fs = require('fs');
const path = require('path');
const config = require('./config');

async function importAllResources() {
  console.log('🚀 Starting Full Markdown Knowledge Base Import from GitHub...\n');

  // 1. Delete duplicate/stale insight file if present
  const staleFile = path.join(process.cwd(), 'LinkedIn Insights', 'resources-1788029642980.md');
  if (fs.existsSync(staleFile)) {
    fs.unlinkSync(staleFile);
    console.log('🗑️ Deleted duplicate insight file: resources-1788029642980.md\n');
  }

  const owner = config.github.owner || 'Drix10';
  const repo = config.github.repo || 'ai-resources';
  const pat = config.github.personalAccessToken;

  const headers = {
    'User-Agent': 'NodeJS-Resource-Importer',
    'Accept': 'application/vnd.github.v3+json',
  };

  if (pat) {
    headers['Authorization'] = `token ${pat}`;
  }

  try {
    console.log(`📡 Fetching tree structure from ${owner}/${repo} (branch: main)...`);
    const treeUrl = `https://api.github.com/repos/${owner}/${repo}/git/trees/main?recursive=1`;
    const response = await fetch(treeUrl, { headers });

    if (!response.ok) {
      throw new Error(`GitHub API returned HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();
    const tree = data.tree || [];

    const mdFiles = tree.filter(item => 
      item.type === 'blob' && 
      item.path.endsWith('.md') && 
      !item.path.startsWith('.') &&
      !item.path.toLowerCase().startsWith('readme')
    );

    console.log(`✅ Discovered ${mdFiles.length} markdown article(s) across remote repository folders.\n`);

    let importedCount = 0;
    const categoryStats = new Map();

    for (const item of mdFiles) {
      const filePath = item.path; // e.g. "AI Developer Tools/resources-249.md"
      const parts = filePath.split('/');
      const fileName = parts.pop();
      const folderPath = parts.join('/');

      const localDir = folderPath ? path.join(process.cwd(), folderPath) : process.cwd();
      if (!fs.existsSync(localDir)) {
        fs.mkdirSync(localDir, { recursive: true });
      }

      const localFilePath = path.join(localDir, fileName);

      // Fetch raw content
      const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/main/${encodeURIComponent(item.path).replace(/%2F/g, '/')}`;
      const fileRes = await fetch(rawUrl, { headers });

      if (fileRes.ok) {
        const content = await fileRes.text();
        fs.writeFileSync(localFilePath, content, 'utf8');
        importedCount++;

        const category = folderPath || 'General';
        categoryStats.set(category, (categoryStats.get(category) || 0) + 1);

        process.stdout.write(`📥 Imported [${importedCount}/${mdFiles.length}]: ${filePath}\n`);
      } else {
        console.warn(`⚠️ Failed to download: ${filePath} (HTTP ${fileRes.status})`);
      }
    }

    console.log('\n=============================================================');
    console.log(`🎉 SUCCESS: Imported ${importedCount} markdown file(s) into local workspace!`);
    console.log('=============================================================');
    console.log('📁 Breakdown by Category:');
    for (const [cat, count] of categoryStats.entries()) {
      console.log(`   - ${cat}: ${count} article(s)`);
    }
    console.log('=============================================================\n');
    console.log('💡 The Next.js Knowledge Hub will now automatically index all articles.');

  } catch (error) {
    console.error('❌ Import failed:', error);
    process.exit(1);
  }
}

importAllResources();
