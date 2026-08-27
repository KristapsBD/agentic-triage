# Raw LLM SDK + Pydantic validation, not an agentic framework

LLM calls (extraction, duplicate judgment) go through direct SDK tool-use calls
validated by Pydantic. No LangGraph / Pydantic AI / other agentic-framework
orchestration layer sits underneath them.

The task is single-shot structured extraction plus a bounded retrieval-then-judge step,
not a multi-step tool-using agent loop. A graph framework would add orchestration
machinery and its own failure modes without buying anything this shape of task needs —
if a future requirement genuinely needs multi-step agentic reasoning, that's a targeted
addition then, not a reason to frameworkify the whole service now.
