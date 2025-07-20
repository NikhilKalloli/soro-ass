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

def analyze_emerging_skills(df, recent_threshold_days=2, top_n=10):
    """Analyzes emerging skills and creates a visualization."""
    print(f"\n--- Step 3: Analyzing Emerging Skills (Recent <= {recent_threshold_days} days) ---")
    
    recent_df = df[df['days_ago'] <= recent_threshold_days]
    older_df = df[df['days_ago'] > recent_threshold_days]

    if recent_df.empty or older_df.empty:
        print("Not enough data to compare recent and older postings for trend analysis.")
        return pd.DataFrame()

    recent_skills_counts = Counter([skill for sublist in recent_df['skills'] for skill in sublist])
    older_skills_counts = Counter([skill for sublist in older_df['skills'] for skill in sublist])

    emerging_skills_scores = {}
    for skill, recent_count in recent_skills_counts.items():
        older_count = older_skills_counts.get(skill, 0)
        if recent_count > older_count:
            # Simple score: new skills or those with increased frequency are candidates
            emerging_skills_scores[skill] = recent_count

    if not emerging_skills_scores:
        print("No clear emerging skills found based on the current data and threshold.")
        return pd.DataFrame()

    # Get the top N emerging skills based on their frequency in recent jobs
    top_emerging = Counter(emerging_skills_scores).most_common(top_n)
    emerging_skills_df = pd.DataFrame(top_emerging, columns=['Skill', 'Recent Frequency'])

    print(f"Top {top_n} potential emerging skills (more frequent in recent postings):")
    for skill, count in top_emerging:
        print(f"- {skill}: {count} mentions in recent jobs")
        
    # Visualization for emerging skills
    plt.figure(figsize=(12, 8))
    sns.barplot(x='Recent Frequency', y='Skill', data=emerging_skills_df, palette='mako')
    plt.title(f'Top {top_n} Emerging Skills', fontsize=16)
    plt.xlabel('Frequency in Recent Postings', fontsize=12)
    plt.ylabel('Skill', fontsize=12)
    plt.tight_layout()
    
    output_path = 'analysis/emerging_skills.png'
    plt.savefig(output_path)
    print(f"Emerging skills visualization saved to {output_path}")

    return emerging_skills_df

# --- 4. LLM-Powered Synthesis ---

def generate_and_save_report(top_skills_df, emerging_skills_df):
    """Uses Gemini to generate a report and saves it to a markdown file with embedded charts."""
    print("\n--- Step 4: Generating Comprehensive Report with Gemini ---")

    if top_skills_df.empty and emerging_skills_df.empty:
        print("No data to generate a report from.")
        return

    model = genai.GenerativeModel('gemini-2.5-flash')

    top_skills_list = top_skills_df.to_string(index=False)
    emerging_skills_list = emerging_skills_df.to_string(index=False) if not emerging_skills_df.empty else "None identified"

    prompt = f"""
    You are a People Analytics expert preparing a report for your company's leadership.
    Your analysis is based on two key visualizations derived from recent job market data:

    1.  **Top In-Demand Skills Chart (`top_skills.png`)**: This bar chart shows the most frequently mentioned skills across all job postings, indicating the core competencies required in the industry today.
    2.  **Emerging Skills Chart (`emerging_skills.png`)**: This bar chart highlights skills that are more frequent in the most recent job postings compared to older ones. These are potential future-looking skills the company should pay attention to.

    Here is the data that populates those charts:

    **Top 10 In-Demand Skills Data:**
    ```
    {top_skills_list}
    ```

    **Top 10 Emerging Skills Data:**
    ```
    {emerging_skills_list}
    ```

    **Your Task:**
    Write a comprehensive analysis in markdown format. Your report must:
    1.  Start with a brief, high-level **Executive Summary**.
    2.  Provide **Key Insights from the 'Top In-Demand Skills' chart**. Explain what these skills represent and why they are foundational.
    3.  Provide **Key Insights from the 'Emerging Skills' chart**. Explain what these trends signify for the future and why they are important.
    4.  Conclude with a set of **Actionable Recommendations** for hiring, upskilling, and overall workforce strategy based on a synthesis of both charts.

    Please generate only the text for the report. The final markdown file will embed the images.
    """

    print("Sending prompt to Gemini...")
    try:
        response = model.generate_content(prompt)
        report_text = response.text
        print("\n--- Gemini Analysis Report (Text-Only) ---")
        print(report_text)
        print("-------------------------------------------\n")

        # Construct the final markdown file with embedded images
        final_report_content = f"""
# Job Market Skills Analysis

## Executive Summary
{report_text.split("Key Insights")[0].split("Executive Summary")[-1].strip()}

## Top In-Demand Skills
![Top In-Demand Skills](top_skills.png)

### Key Insights from the 'Top In-Demand Skills' Chart
{"Key Insights" + report_text.split("Key Insights")[1].split("Actionable Recommendations")[0].strip()}

## Emerging Skills
![Emerging Skills](emerging_skills.png)

### Key Insights from the 'Emerging Skills' Chart
{report_text.split("Key Insights from the 'Emerging Skills' chart")[-1].split("Actionable Recommendations")[0].strip()}

## Actionable Recommendations
{"Actionable Recommendations" + report_text.split("Actionable Recommendations")[-1].strip()}
"""

        report_path = 'analysis/insights_report.md'
        with open(report_path, 'w', encoding='utf-8') as f:
            f.write(final_report_content)
        print(f"Comprehensive markdown report saved to {report_path}")

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
    emerging_skills_df = analyze_emerging_skills(df, recent_threshold_days=2)

    # Step 4: LLM-Powered Synthesis and Report Generation
    if not top_skills_df.empty:
        generate_and_save_report(top_skills_df, emerging_skills_df)


if __name__ == '__main__':
    main()
