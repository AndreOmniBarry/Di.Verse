require('dotenv').config();
console.log('ANTHROPIC:', !!process.env.ANTHROPIC_API_KEY);
console.log('OPENAI:', !!process.env.OPENAI_API_KEY);