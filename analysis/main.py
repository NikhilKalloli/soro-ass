import json
import os
import pandas as pd
import re
import matplotlib.pyplot as plt
import seaborn as sns
from collections import Counter

# --- Configuration ---
# TODO: Add your Gemini API Key here.
# It's recommended to use environment variables for security.
from dotenv import load_dotenv
load_dotenv()
API_KEY = os.getenv("GEMINI_API_KEY")
if not API_KEY:
    raise ValueError("GEMINI_API_KEY not found in environment variables.")

import google.generativeai as genai
genai.configure(api_key=API_KEY)

# --- 1. Data Loading and Preparation ---

def load_and_prepare_data(json_path='analysis/format.json'):
    """Loads job data from JSON, prepares it for analysis."""
    try:
        with open(json_path, 'r', encoding='utf-8') as f:
            data = json.load(f)
    except (FileNotFoundError, json.JSONDecodeError) as e:
        print(f"Error loading or parsing {json_path}: {e}")
        return pd.DataFrame()

    df = pd.json_normalize(data)

    # Combine skills and technologies into a single list
    # The 'get' method provides a default empty list if a key is missing
    df['skills'] = df.apply(
        lambda row: list(set(
            (row.get('from_description.required_skills', []) if isinstance(row.get('from_description.required_skills'), list) else []) +
            (row.get('from_description.technologies', []) if isinstance(row.get('from_description.technologies'), list) else [])
        )),
        axis=1
    )
    
    # Clean up the skills list by removing 'Not specified'
    df['skills'] = df['skills'].apply(lambda skills: [skill for skill in skills if skill and skill.lower() != 'not specified'])

    # Convert 'agoTime' (e.g., "1 day ago") to a numeric value for sorting
    df['days_ago'] = df['agoTime'].str.extract(r'(\d+)').astype(float).fillna(30) # Default to 30 for non-matches

    print("Data loaded and prepared successfully.")
    print(df[['position', 'company', 'days_ago', 'skills']].head())
    
    return df

# --- 2. Frequency Analysis ---

def analyze_top_skills(df, top_n=10):
    """Analyzes and visualizes the most frequent skills."""
    print("\n--- Step 2: Analyzing Top Skills ---")
    
    # Flatten the list of skills and count frequencies
    all_skills = [skill for sublist in df['skills'] for skill in sublist]
    skill_counts = Counter(all_skills)
    
    top_skills = skill_counts.most_common(top_n)
    
    if not top_skills:
        print("No skills found to analyze.")
        return pd.DataFrame()

    print(f"Top {top_n} most in-demand skills:")
    for skill, count in top_skills:
        print(f"- {skill}: {count} mentions")

    # Create DataFrame for visualization
    top_skills_df = pd.DataFrame(top_skills, columns=['Skill', 'Frequency'])
    
    # Visualization
    plt.figure(figsize=(12, 8))
    sns.barplot(x='Frequency', y='Skill', data=top_skills_df, palette='viridis')
    plt.title(f'Top {top_n} In-Demand Skills', fontsize=16)
    plt.xlabel('Frequency (Number of Mentions)', fontsize=12)
    plt.ylabel('Skill', fontsize=12)
    plt.tight_layout()
    
    # Save the plot
    output_path = 'analysis/top_skills.png'
    plt.savefig(output_path)
    print(f"Visualization saved to {output_path}")
    
    return top_skills_df

# --- 3. Trend Analysis ---

def analyze_emerging_skills(df, recent_threshold_days=2):
    """Analyzes emerging skills by comparing recent and older job postings."""
    print(f"\n--- Step 3: Analyzing Emerging Skills (Recent <= {recent_threshold_days} days) ---")
    
    recent_df = df[df['days_ago'] <= recent_threshold_days]
    older_df = df[df['days_ago'] > recent_threshold_days]

    if recent_df.empty or older_df.empty:
        print("Not enough data to compare recent and older postings for trend analysis.")
        return []

    # Calculate skill frequency for both groups
    recent_skills = Counter([skill for sublist in recent_df['skills'] for skill in sublist])
    older_skills = Counter([skill for sublist in older_df['skills'] for skill in sublist])

    # Find skills that are in recent but not older posts, or have grown in frequency
    emerging_skills = []
    for skill, recent_count in recent_skills.items():
        older_count = older_skills.get(skill, 0)
        # Simple heuristic: skill is new or has a higher mention count in recent posts
        if older_count == 0 or (recent_count > older_count):
             emerging_skills.append(skill)
    
    if not emerging_skills:
        print("No clear emerging skills found based on the current data and threshold.")
    else:
        print("Potential emerging skills (more frequent in recent postings):")
        for skill in emerging_skills:
            print(f"- {skill}")
            
    return emerging_skills

# --- 4. LLM-Powered Synthesis ---

def get_llm_insights(top_skills, emerging_skills):
    """Uses Gemini to generate a narrative from the analysis."""
    print("\n--- Step 4: Generating Insights with Gemini ---")

    if not top_skills and not emerging_skills:
        print("No data to generate insights from.")
        return

    # Use 'gemini-pro' as it's a robust model for this kind of text generation task.
    model = genai.GenerativeModel('gemini-2.5-flash')

    top_skills_str = ", ".join(top_skills) if top_skills else "None identified"
    emerging_skills_str = ", ".join(emerging_skills) if emerging_skills else "None identified"

    prompt = f"""
    You are a People Analytics expert at a leading semiconductor company.
    Your task is to analyze job market data to inform the company's hiring and workforce strategy.

    Based on the following data extracted from recent job postings, please provide:
    1.  **Key Insights**: A summary of the most important trends and what they mean for the industry.
    2.  **Actionable Recommendations**: Concrete steps the company should take regarding hiring, training, and strategic workforce planning.

    **Analysis Results:**
    -   **Top 10 Most In-Demand Skills:** {top_skills_str}
    -   **Potential Emerging Skills (more frequent in recent postings):** {emerging_skills_str}

    Please structure your response clearly with headings for "Key Insights" and "Actionable Recommendations".
    Keep the tone professional and data-driven.
    """

    print("Sending prompt to Gemini...")
    try:
        response = model.generate_content(prompt)
        print("\n--- Gemini Analysis Report ---")
        print(response.text)
        print("--- End of Report ---\n")

        # Save the report to a markdown file
        report_path = 'analysis/insights_report.md'
        with open(report_path, 'w', encoding='utf-8') as f:
            f.write(response.text)
        print(f"Gemini report saved to {report_path}")

    except Exception as e:
        print(f"An error occurred while calling the Gemini API: {e}")


def main():
    """Main function to run the analysis pipeline."""
    df = load_and_prepare_data()
    if df.empty:
        return

    # Step 2: Frequency Analysis
    top_skills_df = analyze_top_skills(df)
    
    # Step 3: Trend Analysis
    emerging_skills = analyze_emerging_skills(df, recent_threshold_days=2)

    # Step 4: LLM-Powered Synthesis
    if not top_skills_df.empty:
        get_llm_insights(top_skills_df['Skill'].tolist(), emerging_skills)


if __name__ == '__main__':
    main()
