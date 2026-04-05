import { NextResponse } from 'next/server';

export async function GET() {
  try {
    const res = await fetch('https://openrouter.ai/api/v1/models');
    
    if (!res.ok) {
      let err;
      const text = await res.text();
      try {
        err = JSON.parse(text);
      } catch (e) {
        err = { error: { message: `OpenRouter API error (${res.status}): ${text.substring(0, 100)}` } };
      }
      return NextResponse.json(err, { status: res.status });
    }

    const data = await res.json();
    return NextResponse.json(data);
  } catch (error: any) {
    return NextResponse.json({ error: { message: error.message } }, { status: 500 });
  }
}
