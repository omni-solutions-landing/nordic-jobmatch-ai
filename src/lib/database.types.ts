/**
 * Auto-generated Supabase TypeScript types.
 *
 * Regenerate with:
 *   npx supabase gen types typescript --project-id nwepwncpxcudfypgcyjr > src/lib/database.types.ts
 *
 * DO NOT EDIT MANUALLY.
 */

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      cv_profiles: {
        Row: {
          id: string
          profile_id: string
          raw_text: string
          skills_embedding: string | null
          structured_data: Json
          updated_at: string
        }
        Insert: {
          id?: string
          profile_id: string
          raw_text?: string
          skills_embedding?: string | null
          structured_data?: Json
          updated_at?: string
        }
        Update: {
          id?: string
          profile_id?: string
          raw_text?: string
          skills_embedding?: string | null
          structured_data?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "cv_profiles_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      job_postings: {
        Row: {
          company: string
          country: Database["public"]["Enums"]["nordic_country"]
          created_at: string
          description: string
          expires_at: string | null
          hard_requirements: string[]
          id: string
          job_embedding: string | null
          location: string
          original_language: Database["public"]["Enums"]["source_language"]
          salary_info: Json
          source_platform: string
          source_url: string
          title: string
        }
        Insert: {
          company?: string
          country: Database["public"]["Enums"]["nordic_country"]
          created_at?: string
          description?: string
          expires_at?: string | null
          hard_requirements?: string[]
          id?: string
          job_embedding?: string | null
          location?: string
          original_language?: Database["public"]["Enums"]["source_language"]
          salary_info?: Json
          source_platform?: string
          source_url?: string
          title: string
        }
        Update: {
          company?: string
          country?: Database["public"]["Enums"]["nordic_country"]
          created_at?: string
          description?: string
          expires_at?: string | null
          hard_requirements?: string[]
          id?: string
          job_embedding?: string | null
          location?: string
          original_language?: Database["public"]["Enums"]["source_language"]
          salary_info?: Json
          source_platform?: string
          source_url?: string
          title?: string
        }
        Relationships: []
      }
      matches: {
        Row: {
          created_at: string
          id: string
          job_posting_id: string
          match_score: number
          missing_skills: string[]
          profile_id: string
          status: Database["public"]["Enums"]["match_status"]
        }
        Insert: {
          created_at?: string
          id?: string
          job_posting_id: string
          match_score?: number
          missing_skills?: string[]
          profile_id: string
          status?: Database["public"]["Enums"]["match_status"]
        }
        Update: {
          created_at?: string
          id?: string
          job_posting_id?: string
          match_score?: number
          missing_skills?: string[]
          profile_id?: string
          status?: Database["public"]["Enums"]["match_status"]
        }
        Relationships: [
          {
            foreignKeyName: "matches_job_posting_id_fkey"
            columns: ["job_posting_id"]
            isOneToOne: false
            referencedRelation: "job_postings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "matches_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          country_code: Database["public"]["Enums"]["nordic_country"]
          current_status: Database["public"]["Enums"]["profile_status"]
          email: string
          full_name: string
          id: string
          updated_at: string
        }
        Insert: {
          country_code?: Database["public"]["Enums"]["nordic_country"]
          current_status?: Database["public"]["Enums"]["profile_status"]
          email: string
          full_name?: string
          id: string
          updated_at?: string
        }
        Update: {
          country_code?: Database["public"]["Enums"]["nordic_country"]
          current_status?: Database["public"]["Enums"]["profile_status"]
          email?: string
          full_name?: string
          id?: string
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      match_jobs: {
        Args: {
          filter_country?: Database["public"]["Enums"]["nordic_country"]
          match_count?: number
          match_threshold?: number
          query_embedding: string
        }
        Returns: {
          company: string
          country: Database["public"]["Enums"]["nordic_country"]
          id: string
          location: string
          similarity: number
          source_url: string
          title: string
        }[]
      }
      upsert_cv_profile: {
        Args: {
          p_profile_id: string
          p_raw_text: string
          p_skills_embedding: string
          p_structured_data: Json
        }
        Returns: string
      }
    }
    Enums: {
      match_status:
        | "saved"
        | "applied"
        | "interview"
        | "rejected"
        | "offered"
        | "withdrawn"
      nordic_country: "SE" | "NO" | "DK" | "FI"
      profile_status:
        | "actively_looking"
        | "open_to_offers"
        | "employed"
        | "unavailable"
      source_language: "sv" | "no" | "da" | "fi" | "en"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      match_status: [
        "saved",
        "applied",
        "interview",
        "rejected",
        "offered",
        "withdrawn",
      ],
      nordic_country: ["SE", "NO", "DK", "FI"],
      profile_status: [
        "actively_looking",
        "open_to_offers",
        "employed",
        "unavailable",
      ],
      source_language: ["sv", "no", "da", "fi", "en"],
    },
  },
} as const
