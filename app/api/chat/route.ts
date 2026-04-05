import { NextResponse } from 'next/server';

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { messages, tools, model, key } = body;

    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${key}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://ais-dev-hcqca4qnnnprpinvcpbzs7-787838040825.asia-southeast1.run.app',
        'X-Title': 'Asset Allocation Tracker'
      },
      body: JSON.stringify({
        model: model,
        messages: messages,
        tools: tools,
        tool_choice: 'auto'
      })
    });

    const contentType = res.headers.get('content-type');

    if (!res.ok) {
      let err;
      const text = await res.text();
      // Only log if it's not a standard rate limit to reduce noise
      if (res.status !== 429) {
        console.error(`OpenRouter API error (${res.status}):`, text.substring(0, 200));
      }
      try {
        err = JSON.parse(text);
      } catch (e) {
        err = { error: { message: `OpenRouter API error (${res.status}): ${text.substring(0, 100)}` } };
      }
      return NextResponse.json(err, { status: res.status });
    }

    const text = await res.text();
    
    // Check if content-type is missing or not JSON
    if (!contentType || !contentType.includes('application/json')) {
      return NextResponse.json({ error: { message: `Expected JSON, but got ${contentType || 'unknown'}: ${text.substring(0, 100)}` } }, { status: 502 });
    }

    // Check if text is HTML
    if (text.trim().startsWith('<')) {
      return NextResponse.json({ error: { message: `Expected JSON, but got HTML: ${text.substring(0, 100)}` } }, { status: 502 });
    }

    let data;
    try {
      data = JSON.parse(text);
    } catch (e) {
      return NextResponse.json({ error: { message: `Invalid JSON from OpenRouter: ${text.substring(0, 100)}` } }, { status: 502 });
    }
    return NextResponse.json(data);
  } catch (error: any) {
    return NextResponse.json({ error: { message: error.message } }, { status: 500 });
  }
}
