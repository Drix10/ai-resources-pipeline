// One GraphQL round trip for everything the portfolio shows from GitHub: pinned repos,
// original repos, the contribution calendar and pull requests made to other people's repos.
export const REPO_FIELDS = `
  name nameWithOwner url description stargazerCount forkCount pushedAt homepageUrl
  isPrivate isFork isArchived
  owner { login }
  primaryLanguage { name }
  repositoryTopics(first: 8) { nodes { topic { name } } }
`;

export const PROFILE_QUERY = `
  query($login: String!) {
    user(login: $login) {
      pinnedItems(first: 6, types: REPOSITORY) { nodes { ... on Repository { ${REPO_FIELDS} } } }
      repositories(first: 100, privacy: PUBLIC, isFork: false, ownerAffiliations: OWNER, orderBy: { field: PUSHED_AT, direction: DESC }) {
        nodes { ${REPO_FIELDS} }
      }
      contributionsCollection {
        totalCommitContributions
        totalPullRequestContributions
        totalRepositoryContributions
        contributionCalendar {
          totalContributions
          weeks { contributionDays { date contributionCount contributionLevel } }
        }
        pullRequestContributionsByRepository(maxRepositories: 25) {
          repository { nameWithOwner url description stargazerCount isPrivate owner { login } }
          contributions(first: 3, orderBy: { direction: DESC }) {
            totalCount
            nodes { pullRequest { title url state merged mergedAt } }
          }
        }
      }
    }
  }
`;
