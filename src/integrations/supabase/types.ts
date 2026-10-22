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
          tax_inclusive: boolean
          tax_rate: number
        }
        Insert: {
          created_at?: string
          currency?: string
          id?: string
          name: string
          owner_id: string
          tax_inclusive?: boolean
          tax_rate?: number
        }
        Update: {
          created_at?: string
          currency?: string
          id?: string
          name?: string
          owner_id?: string
          tax_inclusive?: boolean
          tax_rate?: number
        }
        Relationships: []
      }
      cash_movements: {
        Row: {
          amount: number
          created_at: string
          id: string
          kind: string
          reason: string | null
          shift_id: string
          staff_id: string | null
        }
        Insert: {
          amount: number
          created_at?: string
          id?: string
          kind: string
          reason?: string | null
          shift_id: string
          staff_id?: string | null
        }
        Update: {
          amount?: number
          created_at?: string
          id?: string
          kind?: string
          reason?: string | null
          shift_id?: string
          staff_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "cash_movements_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "cash_shifts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_movements_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
        ]
      }
      cash_shifts: {
        Row: {
          business_id: string
          closed_at: string | null
          closed_by: string | null
          counted_cash: number | null
          expected_cash: number | null
          id: string
          notes: string | null
          opened_at: string
          opened_by: string | null
          opening_float: number
          status: string
          store_id: string
          summary: Json | null
          variance: number | null
        }
        Insert: {
          business_id: string
          closed_at?: string | null
          closed_by?: string | null
          counted_cash?: number | null
          expected_cash?: number | null
          id?: string
          notes?: string | null
          opened_at?: string
          opened_by?: string | null
          opening_float?: number
          status?: string
          store_id: string
          summary?: Json | null
          variance?: number | null
        }
        Update: {
          business_id?: string
          closed_at?: string | null
          closed_by?: string | null
          counted_cash?: number | null
          expected_cash?: number | null
          id?: string
          notes?: string | null
          opened_at?: string
          opened_by?: string | null
          opening_float?: number
          status?: string
          store_id?: string
          summary?: Json | null
          variance?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "cash_shifts_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_shifts_closed_by_fkey"
            columns: ["closed_by"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_shifts_opened_by_fkey"
            columns: ["opened_by"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_shifts_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
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
      pin_throttle: {
        Row: {
          auth_uid: string
          business_id: string
          device_id: string
          fails: number
          locked_until: string | null
          updated_at: string
        }
        Insert: {
          auth_uid: string
          business_id: string
          device_id?: string
          fails?: number
          locked_until?: string | null
          updated_at?: string
        }
        Update: {
          auth_uid?: string
          business_id?: string
          device_id?: string
          fails?: number
          locked_until?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "pin_throttle_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      platform_admins: {
        Row: {
          active: boolean
          created_at: string
          id: string
          name: string
          role: string
          user_id: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          id?: string
          name: string
          role?: string
          user_id: string
        }
        Update: {
          active?: boolean
          created_at?: string
          id?: string
          name?: string
          role?: string
          user_id?: string
        }
        Relationships: []
      }
      platform_audit_log: {
        Row: {
          action: string
          actor_label: string
          actor_role: string
          actor_user_id: string | null
          after_state: Json
          before_state: Json
          business_id: string | null
          business_ref: string | null
          created_at: string
          id: string
          reason: string
          target_label: string
        }
        Insert: {
          action: string
          actor_label: string
          actor_role: string
          actor_user_id?: string | null
          after_state: Json
          before_state: Json
          business_id?: string | null
          business_ref?: string | null
          created_at?: string
          id?: string
          reason: string
          target_label: string
        }
        Update: {
          action?: string
          actor_label?: string
          actor_role?: string
          actor_user_id?: string | null
          after_state?: Json
          before_state?: Json
          business_id?: string | null
          business_ref?: string | null
          created_at?: string
          id?: string
          reason?: string
          target_label?: string
        }
        Relationships: [
          {
            foreignKeyName: "platform_audit_log_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      platform_deleted_tenants: {
        Row: {
          business_created_at: string
          business_ref: string
          closed_at: string
          currency: string
          id: string
          name: string
          owner_id: string | null
          paid_store_limit: number
          paid_until: string | null
          plan: string | null
          purged_at: string
          reason: string
          sale_count: number
          staff_count: number
          store_count: number
        }
        Insert: {
          business_created_at: string
          business_ref: string
          closed_at: string
          currency: string
          id?: string
          name: string
          owner_id?: string | null
          paid_store_limit?: number
          paid_until?: string | null
          plan?: string | null
          purged_at?: string
          reason: string
          sale_count?: number
          staff_count?: number
          store_count?: number
        }
        Update: {
          business_created_at?: string
          business_ref?: string
          closed_at?: string
          currency?: string
          id?: string
          name?: string
          owner_id?: string | null
          paid_store_limit?: number
          paid_until?: string | null
          plan?: string | null
          purged_at?: string
          reason?: string
          sale_count?: number
          staff_count?: number
          store_count?: number
        }
        Relationships: []
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
      product_costs: {
        Row: {
          cost: number
          product_id: string
        }
        Insert: {
          cost?: number
          product_id: string
        }
        Update: {
          cost?: number
          product_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_costs_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: true
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
          created_at: string
          id: string
          name: string
          price: number
          reorder_point: number | null
          sku: string | null
          store_id: string
        }
        Insert: {
          active?: boolean
          business_id: string
          category?: string | null
          created_at?: string
          id?: string
          name: string
          price?: number
          reorder_point?: number | null
          sku?: string | null
          store_id: string
        }
        Update: {
          active?: boolean
          business_id?: string
          category?: string | null
          created_at?: string
          id?: string
          name?: string
          price?: number
          reorder_point?: number | null
          sku?: string | null
          store_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "products_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      refund_items: {
        Row: {
          amount: number
          cost: number
          id: string
          name: string
          product_id: string | null
          qty: number
          refund_id: string
          restock: boolean
          sale_item_id: string
        }
        Insert: {
          amount: number
          cost?: number
          id?: string
          name: string
          product_id?: string | null
          qty: number
          refund_id: string
          restock?: boolean
          sale_item_id: string
        }
        Update: {
          amount?: number
          cost?: number
          id?: string
          name?: string
          product_id?: string | null
          qty?: number
          refund_id?: string
          restock?: boolean
          sale_item_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "refund_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "refund_items_refund_id_fkey"
            columns: ["refund_id"]
            isOneToOne: false
            referencedRelation: "refunds"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "refund_items_sale_item_id_fkey"
            columns: ["sale_item_id"]
            isOneToOne: false
            referencedRelation: "sale_items"
            referencedColumns: ["id"]
          },
        ]
      }
      refunds: {
        Row: {
          amount: number
          business_id: string
          cost: number
          created_at: string
          id: string
          method: string
          number: number
          reason: string | null
          sale_id: string
          shift_id: string | null
          staff_id: string | null
          store_id: string
          tax: number
        }
        Insert: {
          amount: number
          business_id: string
          cost?: number
          created_at?: string
          id?: string
          method?: string
          number?: number
          reason?: string | null
          sale_id: string
          shift_id?: string | null
          staff_id?: string | null
          store_id: string
          tax?: number
        }
        Update: {
          amount?: number
          business_id?: string
          cost?: number
          created_at?: string
          id?: string
          method?: string
          number?: number
          reason?: string | null
          sale_id?: string
          shift_id?: string | null
          staff_id?: string | null
          store_id?: string
          tax?: number
        }
        Relationships: [
          {
            foreignKeyName: "refunds_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "refunds_sale_id_fkey"
            columns: ["sale_id"]
            isOneToOne: false
            referencedRelation: "sales"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "refunds_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "cash_shifts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "refunds_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "refunds_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      sale_item_costs: {
        Row: {
          cost: number
          sale_item_id: string
        }
        Insert: {
          cost?: number
          sale_item_id: string
        }
        Update: {
          cost?: number
          sale_item_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "sale_item_costs_sale_item_id_fkey"
            columns: ["sale_item_id"]
            isOneToOne: true
            referencedRelation: "sale_items"
            referencedColumns: ["id"]
          },
        ]
      }
      sale_items: {
        Row: {
          discount: number
          id: string
          name: string
          price: number
          product_id: string | null
          qty: number
          refunded_qty: number
          sale_id: string
        }
        Insert: {
          discount?: number
          id?: string
          name: string
          price: number
          product_id?: string | null
          qty: number
          refunded_qty?: number
          sale_id: string
        }
        Update: {
          discount?: number
          id?: string
          name?: string
          price?: number
          product_id?: string | null
          qty?: number
          refunded_qty?: number
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
          client_ref: string | null
          created_at: string
          created_by: string | null
          customer_name: string | null
          customer_phone: string | null
          discount: number
          id: string
          kind: string
          note: string | null
          number: number
          paid: number
          payment_method: string | null
          refunded: number
          shift_id: string | null
          status: string
          store_id: string
          tax: number
          total: number
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          business_id: string
          client_ref?: string | null
          created_at?: string
          created_by?: string | null
          customer_name?: string | null
          customer_phone?: string | null
          discount?: number
          id?: string
          kind: string
          note?: string | null
          number?: number
          paid?: number
          payment_method?: string | null
          refunded?: number
          shift_id?: string | null
          status: string
          store_id: string
          tax?: number
          total?: number
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          business_id?: string
          client_ref?: string | null
          created_at?: string
          created_by?: string | null
          customer_name?: string | null
          customer_phone?: string | null
          discount?: number
          id?: string
          kind?: string
          note?: string | null
          number?: number
          paid?: number
          payment_method?: string | null
          refunded?: number
          shift_id?: string | null
          status?: string
          store_id?: string
          tax?: number
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
          is_owner: boolean
          name: string
          permissions: string[]
          pin_hash: string
          role: string
          store_id: string | null
        }
        Insert: {
          active?: boolean
          business_id: string
          created_at?: string
          id?: string
          is_owner?: boolean
          name: string
          permissions?: string[]
          pin_hash: string
          role: string
          store_id?: string | null
        }
        Update: {
          active?: boolean
          business_id?: string
          created_at?: string
          id?: string
          is_owner?: boolean
          name?: string
          permissions?: string[]
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
          auth_uid: string | null
          created_at: string
          device_id: string
          expires_at: string
          staff_id: string
          token: string
        }
        Insert: {
          auth_uid?: string | null
          created_at?: string
          device_id?: string
          expires_at?: string
          staff_id: string
          token?: string
        }
        Update: {
          auth_uid?: string | null
          created_at?: string
          device_id?: string
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
      stock_movements: {
        Row: {
          balance_after: number
          created_at: string
          delta: number
          id: string
          note: string | null
          product_id: string
          reason: string
          ref_id: string | null
          staff_id: string | null
          store_id: string
        }
        Insert: {
          balance_after: number
          created_at?: string
          delta: number
          id?: string
          note?: string | null
          product_id: string
          reason?: string
          ref_id?: string | null
          staff_id?: string | null
          store_id: string
        }
        Update: {
          balance_after?: number
          created_at?: string
          delta?: number
          id?: string
          note?: string | null
          product_id?: string
          reason?: string
          ref_id?: string | null
          staff_id?: string | null
          store_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "stock_movements_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_movements_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_movements_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
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
      stock_transfer_lines: {
        Row: {
          id: string
          product_id: string
          qty: number
          transfer_id: string
        }
        Insert: {
          id?: string
          product_id: string
          qty: number
          transfer_id: string
        }
        Update: {
          id?: string
          product_id?: string
          qty?: number
          transfer_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "stock_transfer_lines_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_transfer_lines_transfer_id_fkey"
            columns: ["transfer_id"]
            isOneToOne: false
            referencedRelation: "stock_transfers"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_transfers: {
        Row: {
          business_id: string
          created_at: string
          created_by: string | null
          from_store: string
          id: string
          note: string | null
          number: number
          received_at: string | null
          received_by: string | null
          status: string
          to_store: string
        }
        Insert: {
          business_id: string
          created_at?: string
          created_by?: string | null
          from_store: string
          id?: string
          note?: string | null
          number?: number
          received_at?: string | null
          received_by?: string | null
          status?: string
          to_store: string
        }
        Update: {
          business_id?: string
          created_at?: string
          created_by?: string | null
          from_store?: string
          id?: string
          note?: string | null
          number?: number
          received_at?: string | null
          received_by?: string | null
          status?: string
          to_store?: string
        }
        Relationships: [
          {
            foreignKeyName: "stock_transfers_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_transfers_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_transfers_from_store_fkey"
            columns: ["from_store"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_transfers_received_by_fkey"
            columns: ["received_by"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_transfers_to_store_fkey"
            columns: ["to_store"]
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
          address: string | null
          business_id: string
          created_at: string
          email: string | null
          id: string
          name: string
          phone: string | null
          store_type: string
          tax_inclusive: boolean
          tax_number: string | null
          tax_rate: number
        }
        Insert: {
          address?: string | null
          business_id: string
          created_at?: string
          email?: string | null
          id?: string
          name: string
          phone?: string | null
          store_type?: string
          tax_inclusive?: boolean
          tax_number?: string | null
          tax_rate?: number
        }
        Update: {
          address?: string | null
          business_id?: string
          created_at?: string
          email?: string | null
          id?: string
          name?: string
          phone?: string | null
          store_type?: string
          tax_inclusive?: boolean
          tax_number?: string | null
          tax_rate?: number
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
          billed_stores: number
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
          billed_stores?: number
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
          billed_stores?: number
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
          closed_at: string | null
          created_at: string
          paid_store_limit: number
          paid_until: string | null
          plan: string | null
          suspended_at: string | null
          trial_ends_at: string
        }
        Insert: {
          business_id: string
          closed_at?: string | null
          created_at?: string
          paid_store_limit?: number
          paid_until?: string | null
          plan?: string | null
          suspended_at?: string | null
          trial_ends_at?: string
        }
        Update: {
          business_id?: string
          closed_at?: string | null
          created_at?: string
          paid_store_limit?: number
          paid_until?: string | null
          plan?: string | null
          suspended_at?: string | null
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
      adjust_stock_reason: {
        Args: {
          p_delta: number
          p_note: string
          p_product: string
          p_reason: string
          p_store: string
          p_token: string
        }
        Returns: undefined
      }
      cancel_layby: {
        Args: { p_sale: string; p_token: string }
        Returns: undefined
      }
      cash_move: {
        Args: {
          p_amount: number
          p_kind: string
          p_reason: string
          p_shift: string
          p_token: string
        }
        Returns: undefined
      }
      checkout: {
        Args: {
          p_customer_name: string
          p_customer_phone: string
          p_discounts?: Json
          p_items: Json
          p_kind: string
          p_method: string
          p_note: string
          p_override_pin?: string
          p_payment: number
          p_store: string
          p_tenders?: Json
          p_token: string
        }
        Returns: Json
      }
      checkout_ref: {
        Args: {
          p_client_ref: string
          p_customer_name: string
          p_customer_phone: string
          p_discounts?: Json
          p_items: Json
          p_kind: string
          p_method: string
          p_note: string
          p_override_pin?: string
          p_payment: number
          p_store: string
          p_tenders?: Json
          p_token: string
        }
        Returns: Json
      }
      close_shift: {
        Args: {
          p_counted: number
          p_notes: string
          p_shift: string
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
      create_transfer: {
        Args: {
          p_from: string
          p_items: Json
          p_note: string
          p_to: string
          p_token: string
        }
        Returns: string
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
      get_shift_summary: {
        Args: { p_shift: string; p_token: string }
        Returns: Json
      }
      layby_pay: {
        Args: {
          p_amount: number
          p_method: string
          p_sale: string
          p_token: string
        }
        Returns: string
      }
      lock_all_sessions: { Args: never; Returns: undefined }
      lock_session: { Args: { p_token: string }; Returns: undefined }
      low_stock: { Args: { p_store: string; p_token: string }; Returns: Json }
      my_business_id: { Args: never; Returns: string }
      my_platform_role: { Args: never; Returns: string }
      open_shift: {
        Args: {
          p_float: number
          p_notes: string
          p_store: string
          p_token: string
        }
        Returns: string
      }
      ops_business_roster: {
        Args: {
          p_limit: number
          p_offset: number
          p_q: string
          p_state: string
        }
        Returns: Json
      }
      ops_purge_tenant: {
        Args: {
          p_business_id: string
          p_confirm_name: string
          p_reason: string
        }
        Returns: Json
      }
      ops_set_tenant_state: {
        Args: { p_action: string; p_business_id: string; p_reason: string }
        Returns: Json
      }
      ops_subscription_history: {
        Args: { p_business_id: string; p_limit: number }
        Returns: Json
      }
      ops_update_subscription: {
        Args: {
          p_business_id: string
          p_extend_days?: number
          p_plan?: string
          p_reason?: string
          p_slots?: number
          p_trial_days?: number
          p_until?: string
        }
        Returns: Json
      }
      pin_taken: {
        Args: { p_business: string; p_except: string; p_pin: string }
        Returns: boolean
      }
      process_refund: {
        Args: {
          p_items: Json
          p_method: string
          p_reason: string
          p_sale: string
          p_token: string
        }
        Returns: Json
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
      require_platform_admin: {
        Args: { p_roles: string[] }
        Returns: {
          active: boolean
          created_at: string
          id: string
          name: string
          role: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "platform_admins"
          isOneToOne: true
          isSetofReturn: false
        }
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
      require_staff_nosub: {
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
          p_tenders?: Json
          p_token: string
        }
        Returns: string
      }
      sales_summary: {
        Args: { p_from: string; p_store: string; p_to: string; p_token: string }
        Returns: Json
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
          p_reorder_point?: number
          p_sku: string
          p_store: string
          p_token: string
        }
        Returns: string
      }
      save_staff: {
        Args: {
          p_active: boolean
          p_id: string
          p_name: string
          p_permissions: string[]
          p_pin: string
          p_store: string
          p_token: string
        }
        Returns: string
      }
      save_store: {
        Args: {
          p_address?: string
          p_email?: string
          p_id: string
          p_name: string
          p_phone?: string
          p_tax_inclusive?: boolean
          p_tax_number?: string
          p_tax_rate?: number
          p_token: string
          p_type: string
        }
        Returns: string
      }
      save_tax_settings: {
        Args: { p_inclusive: boolean; p_rate: number; p_token: string }
        Returns: undefined
      }
      set_collection_products: {
        Args: { p_collection: string; p_products: string[]; p_token: string }
        Returns: undefined
      }
      set_product_collections: {
        Args: { p_collections: string[]; p_product: string; p_token: string }
        Returns: undefined
      }
      set_shift_float: {
        Args: { p_float: number; p_shift: string; p_token: string }
        Returns: undefined
      }
      set_stock_qty: {
        Args: {
          p_note: string
          p_product: string
          p_qty: number
          p_reason: string
          p_store: string
          p_token: string
        }
        Returns: number
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
      start_store_subscription_payment:
        | {
            Args: {
              p_currency: string
              p_months: number
              p_stores: number
              p_token: string
            }
            Returns: Json
          }
        | {
            Args: {
              p_currency: string
              p_period: string
              p_stores: number
              p_token: string
            }
            Returns: Json
          }
      start_subscription_payment: {
        Args: { p_currency: string; p_period: string; p_token: string }
        Returns: Json
      }
      subscription_active: { Args: { p_business: string }; Returns: boolean }
      unlock_with_pin: { Args: { p_device_id?: string; p_pin: string }; Returns: Json }
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
