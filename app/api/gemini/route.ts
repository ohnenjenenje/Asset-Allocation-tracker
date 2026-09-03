import { NextResponse } from 'next/server';
import { GoogleGenAI, Type, ThinkingLevel } from '@google/genai';
import { v4 as uuidv4 } from 'uuid';

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { messages, tools, model: googleModel } = body;

    const apiKey = process.env.GEMINI_API_KEY || process.env.NEXT_PUBLIC_GEMINI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: { message: 'Gemini API key not configured (GEMINI_API_KEY)' } }, { status: 500 });
    }

    const ai = new GoogleGenAI({ apiKey });
    const systemPrompt = messages.find((m: any) => m.role === 'system')?.content;

    const geminiMessages: any[] = [];
    let lastGeminiMessage: any = null;

    for (const m of messages.filter((m: any) => m.role !== 'system')) {
      if (m.role === 'tool') {
        const functionResponse = { functionResponse: { name: m.name, response: { result: m.content } } };
        if (lastGeminiMessage && lastGeminiMessage.role === 'user' && lastGeminiMessage.parts.some((p: any) => p.functionResponse)) {
          lastGeminiMessage.parts.push(functionResponse);
          continue;
        } else {
          const newMessage = { role: 'user', parts: [functionResponse] };
          geminiMessages.push(newMessage);
          lastGeminiMessage = newMessage;
          continue;
        }
      }
      const parts: any[] = [];
      if (m.thoughtSignature !== undefined && !m.tool_calls) parts.push({ text: m.thought || '', thought: true, thoughtSignature: m.thoughtSignature });
      if (m.content && m.content.trim()) parts.push({ text: m.content });
      if (m.tool_calls) {
        parts.push(...m.tool_calls.map((tc: any) => ({
          functionCall: {
            name: tc.function.name,
            args: typeof tc.function.arguments === 'string' ? JSON.parse(tc.function.arguments) : tc.function.arguments,
            ...(m.thoughtSignature && { thoughtSignature: m.thoughtSignature }),
          },
        })));
      }
      if (parts.length === 0) parts.push({ text: m.content || '' });
      const newMessage = { role: m.role === 'user' ? 'user' : 'model', parts };
      geminiMessages.push(newMessage);
      lastGeminiMessage = newMessage;
    }

    const mapSchema = (schema: any): any => {
      if (schema.type === 'object') {
        return {
          type: Type.OBJECT,
          description: schema.description,
          properties: schema.properties ? Object.fromEntries(Object.entries(schema.properties).map(([k, v]: any) => [k, mapSchema(v)])) : undefined,
          required: schema.required,
        };
      } else if (schema.type === 'array') {
        return { type: Type.ARRAY, description: schema.description, items: schema.items ? mapSchema(schema.items) : undefined };
      } else if (schema.type === 'number') return { type: Type.NUMBER, description: schema.description };
      else if (schema.type === 'boolean') return { type: Type.BOOLEAN, description: schema.description };
      else return { type: Type.STRING, description: schema.description };
    };

    const geminiTools: any[] = tools
      ? [
          {
            functionDeclarations: tools.map((t: any) => {
              const hasProps = Object.keys(t.function.parameters?.properties || {}).length > 0;
              const decl: any = { name: t.function.name, description: t.function.description };
              if (hasProps) decl.parameters = mapSchema(t.function.parameters);
              return decl;
            }),
          },
        ]
      : [];
    geminiTools.push({ googleSearch: {} });

    const isPro = (googleModel || '').includes('pro');
    const isGemini3 = (googleModel || '').includes('gemini-3');
    const thinkingLevel = isGemini3 ? (isPro ? ThinkingLevel.LOW : ThinkingLevel.MINIMAL) : undefined;

    const response = await ai.models.generateContent({
      model: googleModel,
      contents: geminiMessages,
      config: {
        systemInstruction: systemPrompt,
        tools: geminiTools.length > 0 ? geminiTools : undefined,
        toolConfig: { includeServerSideToolInvocations: true },
        thinkingConfig: thinkingLevel ? { thinkingLevel } : undefined,
      },
    });

    const thoughtPart = response.candidates?.[0]?.content?.parts?.find((p: any) => p.thought === true);
    const thoughtText = thoughtPart?.text;
    const thoughtSignature = thoughtPart?.thoughtSignature;
    const text = response.candidates?.[0]?.content?.parts?.find((p: any) => p.text && p.thought !== true)?.text || '';
    const functionCalls = (response as any).functionCalls;

    if (functionCalls && functionCalls.length > 0) {
      return NextResponse.json({
        model: googleModel,
        isFallback: false,
        choices: [
          {
            message: {
              role: 'assistant',
              content: text || null,
              thought: thoughtText,
              thoughtSignature,
              tool_calls: functionCalls.map((fc: any) => ({
                id: uuidv4(),
                type: 'function',
                function: { name: fc.name, arguments: JSON.stringify(fc.args) },
              })),
            },
          },
        ],
      });
    }

    return NextResponse.json({
      model: googleModel,
      isFallback: false,
      choices: [{ message: { role: 'assistant', content: text, thought: thoughtText, thoughtSignature } }],
    });
  } catch (error: any) {
    console.error('Gemini API error', error);
    return NextResponse.json({ error: { message: error.message || String(error) } }, { status: 500 });
  }
}
