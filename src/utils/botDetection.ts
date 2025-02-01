export function isBot(req: { get: (header: string) => string | undefined }) {
  const userAgent = req.get('user-agent')?.toLowerCase() || '';
  
  // List of known bot user agents
  const botPatterns = [
    'googlebot',
    'bingbot',
    'yandexbot',
    'duckduckbot',
    'slurp',
    'baiduspider',
    'facebookexternalhit',
    'twitterbot',
    'rogerbot',
    'linkedinbot',
    'embedly',
    'quora link preview',
    'showyoubot',
    'outbrain',
    'pinterest',
    'slackbot',
    'vkShare',
    'W3C_Validator',
    'crawler',
    'spider',
    'bot'
  ];

  return botPatterns.some(pattern => userAgent.includes(pattern));
}
