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
      businesses: {
        Row: {
          created_at: string
          currency: string
          id: string
          name: string
          owner_id: string
        }
        Insert: {
          created_at?: string
          currency?: string
          id?: string
          name: string
          owner_id: string
        }
        Update: {
          created_at?: string
          currency?: string
          id?: string
          name?: string
          owner_id?: string
        }
        Relationships: []
      }
      collections: {
        Row: {
          business_id: string
          created_at: string
          discount_pct: number
          id: string
          is_shared: boolean
          name: string
          share_slug: string
        }
        Insert: {
          business_id: string
          created_at?: string
          discount_pct?: number
          id?: string
          is_shared?: boolean
          name: string
          share_slug?: string
        }
        Update: {
          business_id?: string
          created_at?: string
          discount_pct?: number
          id?: string
          is_shared?: boolean
          name?: string
          share_slug?: string
        }
        Relationships: [
          {
            foreignKeyName: "collections_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      expenses: {
        Row: {
          amount: number
          business_id: string
          category: string
          created_at: string
          created_by: string | null
          id: string
          note: string | null
          source: string
          spent_on: string
          store_id: string
        }
        Insert: {
          amount: number
          business_id: string
          category?: string
          created_at?: string
          created_by?: string | null
          id?: string
          note?: string | null
          source?: string
          spent_on?: string
          store_id: string
        }
        Update: {
          amount?: number
          business_id?: string
          category?: string
          created_at?: string
          created_by?: string | null
          id?: string
          note?: string | null
          source?: string
          spent_on?: string
          store_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "expenses_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expenses_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expenses_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      payments: {
        Row: {
          amount: number
          created_at: string
          id: string
          method: string
          sale_id: string
          staff_id: string | null
        }
        Insert: {
          amount: number
          created_at?: string
          id?: string
          method?: string
          sale_id: string
          staff_id?: string | null
        }
        Update: {
          amount?: number
          created_at?: string
          id?: string
          method?: string
          sale_id?: string
          staff_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payments_sale_id_fkey"
            columns: ["sale_id"]
            isOneToOne: false
            referencedRelation: "sales"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
        ]
      }
      product_collections: {
        Row: {
          collection_id: string
          product_id: string
        }
        Insert: {
          collection_id: string
          product_id: string
        }
        Update: {
          collection_id?: string
          product_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_collections_collection_id_fkey"
            columns: ["collection_id"]
            isOneToOne: false
            referencedRelation: "collections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_collections_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          active: boolean
          business_id: string
          category: string | null
          cost: number
          created_at: string
          id: string
          name: string
          price: number
          sku: string | null
        }
        Insert: {
          active?: boolean
          business_id: string
          category?: string | null
          cost?: number
          created_at?: string
          id?: string
          name: string
          price?: number
          sku?: string | null
        }
        Update: {
          active?: boolean
          business_id?: string
          category?: string | null
          cost?: number
          created_at?: string
          id?: string
          name?: string
          price?: number
          sku?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "products_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      sale_items: {
        Row: {
          cost: number
          id: string
          name: string
          price: number
          product_id: string | null
          qty: number
          sale_id: string
        }
        Insert: {
          cost?: number
          id?: string
          name: string
          price: number
          product_id?: string | null
          qty: number
          sale_id: string
        }
        Update: {
          cost?: number
          id?: string
          name?: string
          price?: number
          product_id?: string | null
          qty?: number
          sale_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "sale_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sale_items_sale_id_fkey"
            columns: ["sale_id"]
            isOneToOne: false
            referencedRelation: "sales"
            referencedColumns: ["id"]
          },
        ]
      }
      sales: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          business_id: string
          created_at: string
          created_by: string | null
          customer_name: string | null
          customer_phone: string | null
          id: string
          kind: string
          note: string | null
          number: number
          paid: number
          payment_method: string | null
          status: string
          store_id: string
          total: number
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          business_id: string
          created_at?: string
          created_by?: string | null
          customer_name?: string | null
          customer_phone?: string | null
          id?: string
          kind: string
          note?: string | null
          number?: number
          paid?: number
          payment_method?: string | null
          status: string
          store_id: string
          total?: number
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          business_id?: string
          created_at?: string
          created_by?: string | null
          customer_name?: string | null
          customer_phone?: string | null
          id?: string
          kind?: string
          note?: string | null
          number?: number
          paid?: number
          payment_method?: string | null
          status?: string
          store_id?: string
          total?: number
        }
        Relationships: [
          {
            foreignKeyName: "sales_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      staff: {
        Row: {
          active: boolean
          business_id: string
          created_at: string
          id: string
          name: string
          pin_hash: string
          role: string
          store_id: string | null
        }
        Insert: {
          active?: boolean
          business_id: string
          created_at?: string
          id?: string
          name: string
          pin_hash: string
          role: string
          store_id?: string | null
        }
        Update: {
          active?: boolean
          business_id?: string
          created_at?: string
          id?: string
          name?: string
          pin_hash?: string
          role?: string
          store_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "staff_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      staff_sessions: {
        Row: {
          expires_at: string
          staff_id: string
          token: string
        }
        Insert: {
          expires_at?: string
          staff_id: string
          token?: string
        }
        Update: {
          expires_at?: string
          staff_id?: string
          token?: string
        }
        Relationships: [
          {
            foreignKeyName: "staff_sessions_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_take_lines: {
        Row: {
          counted: number | null
          counted_by: string | null
          expected: number
          product_id: string
          stock_take_id: string
        }
        Insert: {
          counted?: number | null
          counted_by?: string | null
          expected?: number
          product_id: string
          stock_take_id: string
        }
        Update: {
          counted?: number | null
          counted_by?: string | null
          expected?: number
          product_id?: string
          stock_take_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "stock_take_lines_counted_by_fkey"
            columns: ["counted_by"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_take_lines_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_take_lines_stock_take_id_fkey"
            columns: ["stock_take_id"]
            isOneToOne: false
            referencedRelation: "stock_takes"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_takes: {
        Row: {
          business_id: string
          closed_at: string | null
          closed_by: string | null
          created_at: string
          id: string
          started_by: string | null
          status: string
          store_id: string
        }
        Insert: {
          business_id: string
          closed_at?: string | null
          closed_by?: string | null
          created_at?: string
          id?: string
          started_by?: string | null
          status?: string
          store_id: string
        }
        Update: {
          business_id?: string
          closed_at?: string | null
          closed_by?: string | null
          created_at?: string
          id?: string
          started_by?: string | null
          status?: string
          store_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "stock_takes_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_takes_closed_by_fkey"
            columns: ["closed_by"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_takes_started_by_fkey"
            columns: ["started_by"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_takes_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      store_stock: {
        Row: {
          product_id: string
          qty: number
          store_id: string
        }
        Insert: {
          product_id: string
          qty?: number
          store_id: string
        }
        Update: {
          product_id?: string
          qty?: number
          store_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "store_stock_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "store_stock_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      stores: {
        Row: {
          business_id: string
          created_at: string
          id: string
          name: string
          store_type: string
        }
        Insert: {
          business_id: string
          created_at?: string
          id?: string
          name: string
          store_type?: string
        }
        Update: {
          business_id?: string
          created_at?: string
          id?: string
          name?: string
          store_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "stores_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      subscription_payments: {
        Row: {
          amount: number
          business_id: string
          created_at: string
          created_by: string | null
          currency: string
          paid_at: string | null
          period: string
          status: string
          stores: number
          tx_ref: string
        }
        Insert: {
          amount: number
          business_id: string
          created_at?: string
          created_by?: string | null
          currency: string
          paid_at?: string | null
          period: string
          status?: string
          stores: number
          tx_ref: string
        }
        Update: {
          amount?: number
          business_id?: string
          created_at?: string
          created_by?: string | null
          currency?: string
          paid_at?: string | null
          period?: string
          status?: string
          stores?: number
          tx_ref?: string
        }
        Relationships: [
          {
            foreignKeyName: "subscription_payments_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subscription_payments_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
        ]
      }
      subscriptions: {
        Row: {
          business_id: string
          created_at: string
          paid_until: string | null
          plan: string | null
          trial_ends_at: string
        }
        Insert: {
          business_id: string
          created_at?: string
          paid_until?: string | null
          plan?: string | null
          trial_ends_at?: string
        }
        Update: {
          business_id?: string
          created_at?: string
          paid_until?: string | null
          plan?: string | null
          trial_ends_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "subscriptions_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: true
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      _move_stock: {
        Args: { p_sale: string; p_sign: number }
        Returns: undefined
      }
      adjust_stock: {
        Args: {
          p_delta: number
          p_product: string
          p_store: string
          p_token: string
        }
        Returns: undefined
      }
      cancel_layby: {
        Args: { p_sale: string; p_token: string }
        Returns: undefined
      }
      checkout: {
        Args: {
          p_customer_name: string
          p_customer_phone: string
          p_items: Json
          p_kind: string
          p_method: string
          p_note: string
          p_payment: number
          p_store: string
          p_token: string
        }
        Returns: Json
      }
      close_stock_take: {
        Args: { p_take: string; p_token: string }
        Returns: undefined
      }
      complete_subscription_payment: {
        Args: { p_tx_ref: string }
        Returns: undefined
      }
      count_stock: {
        Args: {
          p_counted: number
          p_product: string
          p_take: string
          p_token: string
        }
        Returns: undefined
      }
      delete_collection: {
        Args: { p_id: string; p_token: string }
        Returns: undefined
      }
      delete_expense: {
        Args: { p_id: string; p_token: string }
        Returns: undefined
      }
      effective_price: { Args: { p_product: string }; Returns: number }
      get_shared_collection: { Args: { p_slug: string }; Returns: Json }
      layby_pay: {
        Args: {
          p_amount: number
          p_method: string
          p_sale: string
          p_token: string
        }
        Returns: string
      }
      lock_session: { Args: { p_token: string }; Returns: undefined }
      my_business_id: { Args: never; Returns: string }
      pin_taken: {
        Args: { p_business: string; p_except: string; p_pin: string }
        Returns: boolean
      }
      record_expense: {
        Args: {
          p_amount: number
          p_category: string
          p_date: string
          p_note: string
          p_source: string
          p_store: string
          p_token: string
        }
        Returns: string
      }
      require_staff: {
        Args: { p_roles: string[]; p_token: string }
        Returns: {
          active: boolean
          business_id: string
          created_at: string
          id: string
          name: string
          pin_hash: string
          role: string
          store_id: string | null
        }
        SetofOptions: {
          from: "*"
          to: "staff"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      review_invoice: {
        Args: {
          p_approve: boolean
          p_method: string
          p_payment: number
          p_sale: string
          p_token: string
        }
        Returns: string
      }
      save_collection: {
        Args: {
          p_discount: number
          p_id: string
          p_name: string
          p_shared: boolean
          p_token: string
        }
        Returns: string
      }
      save_product: {
        Args: {
          p_active: boolean
          p_category: string
          p_cost: number
          p_id: string
          p_name: string
          p_price: number
          p_sku: string
          p_token: string
        }
        Returns: string
      }
      save_staff: {
        Args: {
          p_active: boolean
          p_id: string
          p_name: string
          p_pin: string
          p_role: string
          p_store: string
          p_token: string
        }
        Returns: string
      }
      save_store: {
        Args: { p_id: string; p_name: string; p_token: string; p_type: string }
        Returns: string
      }
      set_collection_products: {
        Args: { p_collection: string; p_products: string[]; p_token: string }
        Returns: undefined
      }
      set_product_collections: {
        Args: { p_collections: string[]; p_product: string; p_token: string }
        Returns: undefined
      }
      setup_business: {
        Args: {
          p_currency: string
          p_name: string
          p_owner_name: string
          p_pin: string
          p_store_name: string
          p_store_type: string
        }
        Returns: string
      }
      start_stock_take: {
        Args: { p_store: string; p_token: string }
        Returns: string
      }
      start_subscription_payment: {
        Args: { p_currency: string; p_period: string; p_token: string }
        Returns: Json
      }
      unlock_with_pin: { Args: { p_pin: string }; Returns: Json }
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
