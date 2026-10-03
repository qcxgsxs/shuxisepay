export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      accounts: {
        Row: {
          banned: boolean
          created_at: string
          created_by: string | null
          id: string
          password: string
          permissions: Json
          reset_token: string | null
          role: string
          username: string
        }
        Insert: {
          banned?: boolean
          created_at?: string
          created_by?: string | null
          id?: string
          password: string
          permissions?: Json
          reset_token?: string | null
          role: string
          username: string
        }
        Update: {
          banned?: boolean
          created_at?: string
          created_by?: string | null
          id?: string
          password?: string
          permissions?: Json
          reset_token?: string | null
          role?: string
          username?: string
        }
        Relationships: []
      }
      api_keys: {
        Row: {
          created_at: string
          id: string
          key: string
          payment_method_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          key: string
          payment_method_id: string
        }
        Update: {
          created_at?: string
          id?: string
          key?: string
          payment_method_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "api_keys_payment_method_id_fkey"
            columns: ["payment_method_id"]
            isOneToOne: false
            referencedRelation: "payment_methods"
            referencedColumns: ["id"]
          },
        ]
      }
      balances: {
        Row: {
          account_id: string
          amount: number
          currency_id: string
        }
        Insert: {
          account_id: string
          amount?: number
          currency_id: string
        }
        Update: {
          account_id?: string
          amount?: number
          currency_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "balances_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "balances_currency_id_fkey"
            columns: ["currency_id"]
            isOneToOne: false
            referencedRelation: "currencies"
            referencedColumns: ["id"]
          },
        ]
      }
      currencies: {
        Row: {
          code: string
          created_at: string
          id: string
          name: string
          rate_expr: string
          rate_log10: number
          symbol: string
          visibility: Json
        }
        Insert: {
          code: string
          created_at?: string
          id?: string
          name: string
          rate_expr?: string
          rate_log10?: number
          symbol?: string
          visibility?: Json
        }
        Update: {
          code?: string
          created_at?: string
          id?: string
          name?: string
          rate_expr?: string
          rate_log10?: number
          symbol?: string
          visibility?: Json
        }
        Relationships: []
      }
      facilities: {
        Row: {
          created_at: string
          currency_id: string | null
          engineer_id: string
          fee: number
          id: string
          ip: string | null
          kind: string
          lat: number | null
          lng: number | null
          name: string
          radius_m: number
        }
        Insert: {
          created_at?: string
          currency_id?: string | null
          engineer_id: string
          fee?: number
          id?: string
          ip?: string | null
          kind: string
          lat?: number | null
          lng?: number | null
          name: string
          radius_m?: number
        }
        Update: {
          created_at?: string
          currency_id?: string | null
          engineer_id?: string
          fee?: number
          id?: string
          ip?: string | null
          kind?: string
          lat?: number | null
          lng?: number | null
          name?: string
          radius_m?: number
        }
        Relationships: [
          {
            foreignKeyName: "facilities_currency_id_fkey"
            columns: ["currency_id"]
            isOneToOne: false
            referencedRelation: "currencies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "facilities_engineer_id_fkey"
            columns: ["engineer_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      logs: {
        Row: {
          account_id: string | null
          action: string
          created_at: string
          detail: Json
          id: number
          role: string | null
          username: string | null
        }
        Insert: {
          account_id?: string | null
          action: string
          created_at?: string
          detail?: Json
          id?: number
          role?: string | null
          username?: string | null
        }
        Update: {
          account_id?: string | null
          action?: string
          created_at?: string
          detail?: Json
          id?: number
          role?: string | null
          username?: string | null
        }
        Relationships: []
      }
      messages: {
        Row: {
          body: string
          created_at: string
          from_id: string
          id: number
          to_id: string
        }
        Insert: {
          body: string
          created_at?: string
          from_id: string
          id?: number
          to_id: string
        }
        Update: {
          body?: string
          created_at?: string
          from_id?: string
          id?: number
          to_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "messages_from_id_fkey"
            columns: ["from_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_to_id_fkey"
            columns: ["to_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_methods: {
        Row: {
          created_at: string
          currency_ids: string[]
          fee_normal: number
          id: string
          name: string
          owner_id: string | null
        }
        Insert: {
          created_at?: string
          currency_ids?: string[]
          fee_normal?: number
          id?: string
          name: string
          owner_id?: string | null
        }
        Update: {
          created_at?: string
          currency_ids?: string[]
          fee_normal?: number
          id?: string
          name?: string
          owner_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payment_methods_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      presence: {
        Row: {
          account_id: string
          facility_id: string
          last_charged: string
          since: string
        }
        Insert: {
          account_id: string
          facility_id: string
          last_charged?: string
          since?: string
        }
        Update: {
          account_id?: string
          facility_id?: string
          last_charged?: string
          since?: string
        }
        Relationships: [
          {
            foreignKeyName: "presence_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "presence_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          area: Json
          created_at: string
          currency_id: string
          description: string
          id: string
          images: string[]
          name: string
          price: number
          seller_id: string
          stock: number
          videos: string[]
        }
        Insert: {
          area?: Json
          created_at?: string
          currency_id: string
          description?: string
          id?: string
          images?: string[]
          name: string
          price: number
          seller_id: string
          stock?: number
          videos?: string[]
        }
        Update: {
          area?: Json
          created_at?: string
          currency_id?: string
          description?: string
          id?: string
          images?: string[]
          name?: string
          price?: number
          seller_id?: string
          stock?: number
          videos?: string[]
        }
        Relationships: [
          {
            foreignKeyName: "products_currency_id_fkey"
            columns: ["currency_id"]
            isOneToOne: false
            referencedRelation: "currencies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_seller_id_fkey"
            columns: ["seller_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      sessions: {
        Row: {
          account_id: string
          created_at: string
          token: string
        }
        Insert: {
          account_id: string
          created_at?: string
          token: string
        }
        Update: {
          account_id?: string
          created_at?: string
          token?: string
        }
        Relationships: [
          {
            foreignKeyName: "sessions_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      settings: {
        Row: {
          key: string
          value: Json
        }
        Insert: {
          key: string
          value: Json
        }
        Update: {
          key?: string
          value?: Json
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
