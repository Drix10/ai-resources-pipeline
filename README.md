<div class="hero-icon" align="center">
  <img src="https://raw.githubusercontent.com/PKief/vscode-material-icon-theme/ec559a9f6bfd399b82bb44393651661b08aaf7ba/icons/folder-markdown-open.svg" width="100" />
</div>

<h1 align="center">
Twitter-Gemini-GitHub-MVP
</h1>
<h4 align="center">Automates Twitter data collection and GitHub Markdown storage using Gemini AI</h4>
<h4 align="center">Developed with the software and tools below.</h4>
<div class="badges" align="center">
  <img src="https://img.shields.io/badge/Framework-Node.js%20with%20Express.js-blue" alt="Framework">
  <img src="https://img.shields.io/badge/Backend-JavaScript-red" alt="Backend">
  <img src="https://img.shields.io/badge/Database-MongoDB-blue" alt="Database">
  <img src="https://img.shields.io/badge/AI-Google%20Gemini-black" alt="AI">
</div>
<div class="badges" align="center">
  <img src="https://img.shields.io/github/last-commit/coslynx/Twitter-Gemini-GitHub-MVP?style=flat-square&color=5D6D7E" alt="git-last-commit" />
  <img src="https://img.shields.io/github/commit-activity/m/coslynx/Twitter-Gemini-GitHub-MVP?style=flat-square&color=5D6D7E" alt="GitHub commit activity" />
  <img src="https://img.shields.io/github/languages/top/coslynx/Twitter-Gemini-GitHub-MVP?style=flat-square&color=5D6D7E" alt="GitHub top language" />
</div>

## 📑 Table of Contents
- 📍 Overview
- 📦 Features
- 📂 Structure
- 💻 Installation
- 🏗️ Usage
- 🌐 Hosting
- 📄 License
- 👏 Authors

## 📍 Overview
This repository contains a Minimum Viable Product (MVP) that automates the collection of Twitter data and stores it in a structured Markdown format on GitHub, leveraging Google's Gemini AI for content processing.  This addresses the need for researchers and developers to efficiently collect and organize relevant Twitter content.

## 📦 Features
|    | Feature                          | Description                                                                                                                            |
|----|----------------------------------|-----------------------------------------------------------------------------------------------------------------------------------------|
| 1  | Twitter Authentication & Scraping | Authenticates with the Twitter API v2 and scrapes tweets based on specified keywords or hashtags. Handles rate limits and errors.             |
| 2  | Gemini AI Content Generation     | Uses Google's Gemini API to convert scraped tweet data into well-formatted Markdown files.                                                  |
| 3  | GitHub Repository Management      | Interacts with a designated GitHub repository to commit the generated Markdown files to a specified folder. Handles rate limits and errors. |
| 4  | Automated Daily Execution        | Automates the entire process using Node-cron to run daily at a specified time. Includes error handling and email notifications.           |


## 📂 Structure
```text
twitter-to-github-mvp/
├── .env
├── package.json
└── src/
    ├── api/
    │   ├── app.js
    │   ├── controllers/
    │   │   ├── github.js
    │   │   └── tweets.js
    │   ├── models/
    │   │   └── tweet.js
    │   ├── routes/
    │   │   ├── github.js
    │   │   └── tweets.js
    │   └── services/
    │       ├── github.js
    │       ├── gemini.js
    │       ├── twitter.js
    │       └── cron.js
    ├── config/
    │   └── index.js
    └── utils/
        ├── dbConnection.js
        └── helpers.js
    └── tests/
        ├── unit/
        │   ├── twitter.test.js
        │   ├── gemini.test.js
        │   └── github.test.js
        └── integration/
            ├── tweets.test.js
            └── github.test.js

```

## 💻 Installation
### 🔧 Prerequisites
- Node.js v16+
- npm 8+
- MongoDB
- A Google Cloud Project with the Gemini API enabled
- A GitHub account and Personal Access Token

### 🚀 Setup Instructions
1. Clone the repository:
   ```bash
   git clone https://github.com/coslynx/Twitter-Gemini-GitHub-MVP.git
   cd Twitter-Gemini-GitHub-MVP
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. Create a `.env` file using the `.env.example` file and populate it with your API keys and credentials.
4.  Start the MongoDB server.

## 🏗️ Usage
### 🏃‍♂️ Running the MVP
1. Start the server:
   ```bash
   npm run start
   ```
2. The application will run on port 3000.  The cron job will run daily at midnight UTC.


## 🌐 Hosting
This application is designed to be deployed on a server with Node.js and MongoDB. Consider using a cloud provider such as AWS, Google Cloud, or Heroku.


## 📄 License & Attribution

### 📄 License
This Minimum Viable Product (MVP) is licensed under the [GNU AGPLv3](https://choosealicense.com/licenses/agpl-3.0/) license.

### 🤖 AI-Generated MVP
This MVP was entirely generated using artificial intelligence through [CosLynx.com](https://coslynx.com).

No human was directly involved in the coding process of the repository: Twitter-Gemini-GitHub-MVP

### 📞 Contact
For any questions or concerns regarding this AI-generated MVP, please contact CosLynx at:
- Website: [CosLynx.com](https://coslynx.com)
- Twitter: [@CosLynxAI](https://x.com/CosLynxAI)

<p align="center">
  <h1 align="center">🌐 CosLynx.com</h1>
</p>
<p align="center">
  <em>Create Your Custom MVP in Minutes With CosLynxAI!</em>
</p>
<div class="badges" align="center">
<img src="https://img.shields.io/badge/Developers-Drix10,_Kais_Radwan-red" alt="">
<img src="https://img.shields.io/badge/Website-CosLynx.com-blue" alt="">
<img src="https://img.shields.io/badge/Backed_by-Google,_Microsoft_&_Amazon_for_Startups-red" alt="">
<img src="https://img.shields.io/badge/Finalist-Backdrop_Build_v4,_v6-black" alt="">
</div>
```