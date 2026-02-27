"""
RetailMind AI Engine
====================
Single class that wraps Groq LLM for all three AI surfaces:
  • generate_decisions()  — per-product AI action cards
  • generate_insights()   — full business health narrative
  • copilot()             — conversational Q&A over live data

The LLM receives rich, structured data context and returns JSON responses
that the frontend renders. No rule-based logic anywhere in this file.
"""

import os, json, textwrap
import pandas as pd
import numpy as np
from groq import Groq

_MODEL   = "llama-3.1-8b-instant"
_MODEL_H = "llama3-70b-8192"   # heavier model for insights/decisions

class AIEngine:
    def __init__(self):
        key = os.environ.get("GROQ_API_KEY", "")
        self.client = Groq(api_key=key) if key else None
        self._use_heavy = True   # flip to False if rate-limited

    # ── low-level LLM caller ─────────────────────────────────────────────────
    def _call(self, system: str, user: str, max_tokens=1800, heavy=False) -> str:
        if self.client is None:
            raise RuntimeError("GROQ_API_KEY not set")
        model = (_MODEL_H if heavy and self._use_heavy else _MODEL)
        try:
            rsp = self.client.chat.completions.create(
                model=model,
                messages=[
                    {"role":"system","content": system},
                    {"role":"user",  "content": user},
                ],
                temperature=0.3,
                max_tokens=max_tokens,
                response_format={"type":"json_object"},
            )
            return rsp.choices[0].message.content
        except Exception as e:
            # graceful fallback to lighter model
            if heavy:
                self._use_heavy = False
                return self._call(system, user, max_tokens, heavy=False)
            raise e

    # ── data summariser (shared) ─────────────────────────────────────────────
    @staticmethod
    def _build_product_context(df: pd.DataFrame, max_products=60) -> str:
        prod = df.groupby("Product").agg(
            category  = ("Category","first"),
            sold      = ("Units_Sold","sum"),
            stock     = ("Current_Stock","mean"),
            demand    = ("Predicted_Demand","mean"),
            price     = ("Price","mean"),
            comp      = ("Competitor_Price","mean"),
        ).reset_index().sort_values("sold", ascending=False).head(max_products)

        rows = []
        for _, r in prod.iterrows():
            stock_cover = round(r["stock"] / max(r["demand"], 1) * 100, 0)
            price_gap   = round((r["price"] - r["comp"]) / max(r["comp"], 1) * 100, 1)
            rows.append(
                f'  {{"product":"{r["Product"]}","category":"{r["category"]}",'
                f'"sold":{int(r["sold"])},"stock":{round(r["stock"],0)},'
                f'"predicted_demand":{round(r["demand"],1)},"stock_coverage_pct":{stock_cover},'
                f'"price":{round(r["price"],2)},"competitor_price":{round(r["comp"],2)},'
                f'"price_gap_pct":{price_gap}}}'
            )
        store_kpis = (
            f"total_products={df['Product'].nunique()}, "
            f"categories={df['Category'].nunique()}, "
            f"total_units_sold={int(df['Units_Sold'].sum())}, "
            f"avg_stock={round(df['Current_Stock'].mean(),1)}, "
            f"avg_predicted_demand={round(df['Predicted_Demand'].mean(),1)}"
        )
        return f"STORE KPIs: {store_kpis}\n\nPRODUCT DATA (JSON array):\n[\n" + ",\n".join(rows) + "\n]"

    # ═════════════════════════════════════════════════════════════════════════
    # 1. AI DECISIONS
    # ═════════════════════════════════════════════════════════════════════════
    def generate_decisions(self, df: pd.DataFrame) -> list:
        context = self._build_product_context(df)

        system = textwrap.dedent("""
            You are an expert retail business analyst AI.
            Your job: analyze each product's inventory and pricing data and generate 
            actionable business decisions for a retail shop owner.

            For EACH product in the dataset return a JSON decision object.
            Respond ONLY with valid JSON: {"decisions": [ ...array of product decision objects... ]}

            Each decision object must have EXACTLY these fields:
            {
              "product": string,
              "category": string,
              "action": one of ["Restock Now", "Clear Stock", "Increase Price", "Cut Price", "Bundle Offer", "Monitor", "Promote"],
              "urgency": one of ["Critical", "High", "Medium", "Low"],
              "headline": string (max 8 words, punchy action title),
              "reasoning": string (2-3 sentences, business reasoning, no technical jargon),
              "expected_impact": string (1 sentence, what will happen if followed),
              "metric_stock": number (current stock value),
              "metric_demand": number (predicted demand value),
              "metric_price_gap": number (price gap % vs competitor, positive = your price is higher),
              "priority_score": integer 0-100 (urgency score, 100=most urgent),
              "tags": array of up to 3 short strings like ["Low Stock","Price Alert","Top Seller"]
            }

            Be specific with numbers. Write for a non-technical shop owner.
            Do NOT mention machine learning, algorithms, or technical terms.
            Return decisions for ALL products in the input.
        """).strip()

        user = f"Analyze this retail store data and generate decisions for every product:\n\n{context}"

        try:
            raw  = self._call(system, user, max_tokens=4000, heavy=True)
            data = json.loads(raw)
            decisions = data.get("decisions", [])
            # sort by priority
            decisions.sort(key=lambda x: x.get("priority_score",0), reverse=True)
            return decisions
        except Exception as e:
            return [{"error": str(e), "product":"Error","action":"Monitor",
                     "urgency":"Low","headline":"AI analysis failed",
                     "reasoning":f"Could not generate decisions: {e}",
                     "expected_impact":"","metric_stock":0,"metric_demand":0,
                     "metric_price_gap":0,"priority_score":0,"tags":[],"category":""}]

    # ═════════════════════════════════════════════════════════════════════════
    # 2. AI INSIGHTS
    # ═════════════════════════════════════════════════════════════════════════
    def generate_insights(self, df: pd.DataFrame) -> dict:
        context = self._build_product_context(df)

        system = textwrap.dedent("""
            You are a senior retail business consultant AI.
            Analyze the retail store data provided and return a comprehensive 
            business intelligence report as JSON.

            Respond ONLY with valid JSON in this EXACT structure:
            {
              "health_score": integer 0-100,
              "health_label": string (e.g. "Strong", "At Risk", "Critical"),
              "executive_summary": string (3-4 sentences, high-level business narrative),
              "revenue_opportunity": string (estimated opportunity in plain language),
              "risks": [
                {"title":string, "severity":"Critical"|"High"|"Medium", "detail":string, "products_affected":integer}
              ],
              "opportunities": [
                {"title":string, "icon":string (single emoji), "detail":string, "potential_value":string}
              ],
              "actions": [
                {"priority":integer(1-5), "action":string, "timeframe":"Today"|"This Week"|"This Month", "detail":string}
              ],
              "category_insights": [
                {"category":string, "insight":string, "performance":"Strong"|"Average"|"Weak"}
              ],
              "top_products": [string],
              "at_risk_products": [string],
              "generated_at": "now"
            }

            Write everything for a non-technical retail shop owner.
            Be specific with product names and numbers from the data.
            Do NOT mention ML, algorithms, or technical concepts.
        """).strip()

        user = f"Generate a full business intelligence report for this retail store:\n\n{context}"

        try:
            raw  = self._call(system, user, max_tokens=3000, heavy=True)
            data = json.loads(raw)
            return data
        except Exception as e:
            return {"error": str(e), "health_score": 0, "health_label":"Error",
                    "executive_summary": f"Insights generation failed: {e}",
                    "risks":[], "opportunities":[], "actions":[], "category_insights":[],
                    "top_products":[], "at_risk_products":[], "revenue_opportunity":""}

    # ═════════════════════════════════════════════════════════════════════════
    # 3. COPILOT
    # ═════════════════════════════════════════════════════════════════════════
    def copilot(self, question: str, df: pd.DataFrame) -> dict:
        context = self._build_product_context(df, max_products=80)

        system = textwrap.dedent("""
            You are RetailMind, an expert AI assistant for retail shop owners.
            You have access to the owner's live store data below.
            Answer their question conversationally, using specific data from the store.

            Respond ONLY with valid JSON in this structure:
            {
              "answer": string (main conversational answer, 2-4 sentences, markdown **bold** for key numbers/names),
              "data_cards": [
                {"label":string, "value":string, "icon":string(emoji), "color":"green"|"red"|"orange"|"blue"|"purple"}
              ],
              "table": null OR {
                "title": string,
                "headers": [string],
                "rows": [[string]]
              },
              "follow_up": [string] (2-3 follow-up questions the user might want to ask)
            }

            Rules:
            - Use specific product names, numbers, and percentages from the data
            - Speak like a friendly business advisor, not a data scientist
            - data_cards should show the most relevant 3-6 metrics for the question
            - Include a table only when comparing multiple products/categories
            - Rows in table max 15
            - If you don't know, say so clearly
            - Never mention AI, ML, algorithms, models, or any technical terms
        """).strip()

        user = f"Store data:\n{context}\n\nOwner's question: {question}"

        try:
            raw  = self._call(system, user, max_tokens=1500)
            data = json.loads(raw)
            return data
        except Exception as e:
            return {
                "answer": f"I had trouble processing that. Could you rephrase? (Error: {e})",
                "data_cards": [],
                "table": None,
                "follow_up": ["What are my top selling products?", "What needs restocking?"]
            }
