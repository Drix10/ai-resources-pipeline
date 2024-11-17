const { GeminiService } = require('../../api/services/gemini');
const { logger } = require('../../utils/helpers');

jest.mock('../../utils/helpers');

describe('GeminiService', () => {
  let service;
  let mockGeminiClient;

  beforeEach(() => {
    mockGeminiClient = {
      generateText: jest.fn(),
    };
    service = new GeminiService(mockGeminiClient);
    jest.clearAllMocks();
  });

  describe('generateMarkdown', () => {
    it('should successfully generate Markdown for a single tweet', async () => {
      const singleTweet = { id: '123', text: 'Test tweet' };
      const mockResponse = [{ text: '# Test tweet' }];
      mockGeminiClient.generateText.mockResolvedValue(mockResponse);
      const result = await service.generateMarkdown([singleTweet]);
      expect(result).toEqual([{ id: '123', text: 'Test tweet', markdown: '# Test tweet' }]);
      expect(mockGeminiClient.generateText).toHaveBeenCalledWith({ prompt: expect.stringContaining(JSON.stringify(singleTweet)) });
    });

    it('should handle empty tweet array', async () => {
      const result = await service.generateMarkdown([]);
      expect(result).toEqual([]);
      expect(mockGeminiClient.generateText).not.toHaveBeenCalled();
    });


    it('should handle null tweet array', async () => {
      const result = await service.generateMarkdown(null);
      expect(result).toEqual([]);
      expect(mockGeminiClient.generateText).not.toHaveBeenCalled();
    });

    it('should handle invalid tweet array', async () => {
      const result = await service.generateMarkdown('invalid');
      expect(result).toEqual([]);
      expect(mockGeminiClient.generateText).not.toHaveBeenCalled();
    });

    it('should handle multiple tweets', async () => {
      const tweets = [
        { id: '1', text: 'Tweet 1' },
        { id: '2', text: 'Tweet 2' },
      ];
      const mockResponses = [
        { text: '# Tweet 1' },
        { text: '# Tweet 2' },
      ];
      mockGeminiClient.generateText.mockImplementation((prompt) => {
          const tweetId = JSON.parse(prompt.prompt.split('\\n')[1]).id;
          return Promise.resolve([{ text: `# Tweet ${tweetId}` }]);
      });
      const result = await service.generateMarkdown(tweets);
      expect(result).toEqual([
        { id: '1', text: 'Tweet 1', markdown: '# Tweet 1' },
        { id: '2', text: 'Tweet 2', markdown: '# Tweet 2' },
      ]);
      expect(mockGeminiClient.generateText).toHaveBeenCalledTimes(2);
    });

    it('should handle Gemini API error', async () => {
      const tweet = { id: '1', text: 'Tweet 1' };
      const mockError = new Error('Gemini API error');
      mockGeminiClient.generateText.mockRejectedValue(mockError);
      const result = await service.generateMarkdown([tweet]);
      expect(result).toEqual([{ id: '1', text: 'Tweet 1', markdown: 'Markdown generation failed' }]);
      expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('Error generating Markdown for tweet: 1'), expect.objectContaining({stack: expect.any(String)}));
    });

    it('should handle empty tweet text', async () => {
      const tweet = { id: '1', text: '' };
      mockGeminiClient.generateText.mockResolvedValue([{ text: '' }]);
      const result = await service.generateMarkdown([tweet]);
      expect(result).toEqual([{ id: '1', text: '', markdown: '' }]);
    });

    it('should handle tweet with only entities', async () => {
      const tweet = { id: '1', text: '', entities: { urls: [{ url: 'http://example.com' }] } };
      mockGeminiClient.generateText.mockResolvedValue([{ text: '[http://example.com](http://example.com)' }]);
      const result = await service.generateMarkdown([tweet]);
      expect(result).toEqual([{ id: '1', text: '', entities: { urls: [{ url: 'http://example.com' }] }, markdown: '[http://example.com](http://example.com)' }]);
    });

    it('should handle malformed tweet data', async () => {
        const tweet = { id: '1', text: 'test', entities: { urls: [{ url: 'http://example.com', expanded_url: null }] } };
        mockGeminiClient.generateText.mockResolvedValue([{ text: 'Markdown summary' }]);
        const result = await service.generateMarkdown([tweet]);
        expect(result).toEqual([{ id: '1', text: 'test', entities: { urls: [{ url: 'http://example.com', expanded_url: null }] }, markdown: 'Markdown summary' }]);
    });

    it('should handle a tweet with a long text', async () => {
      const longText = 'a'.repeat(10000);
      const tweet = { id: '1', text: longText };
      mockGeminiClient.generateText.mockResolvedValue([{ text: 'Markdown summary of long text' }]);
      const result = await service.generateMarkdown([tweet]);
      expect(result).toEqual([{ id: '1', text: longText, markdown: 'Markdown summary of long text' }]);
    });

    it('should handle a tweet with special characters', async () => {
        const tweet = { id: '1', text: 'This tweet has special characters: !@#$%^&*()_+=-`~[]\{}|;\':",./<>? '};
        mockGeminiClient.generateText.mockResolvedValue([{ text: 'Markdown summary' }]);
        const result = await service.generateMarkdown([tweet]);
        expect(result).toEqual([{ id: '1', text: 'This tweet has special characters: !@#$%^&*()_+=-`~[]\{}|;\':",./<>? ', markdown: 'Markdown summary' }]);
    });

  });
});
```