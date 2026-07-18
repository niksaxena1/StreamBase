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
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      accounts: {
        Row: {
          created_at: string
          distributor_id: string
          id: string
          name: string
        }
        Insert: {
          created_at?: string
          distributor_id: string
          id?: string
          name: string
        }
        Update: {
          created_at?: string
          distributor_id?: string
          id?: string
          name?: string
        }
        Relationships: [
          {
            foreignKeyName: "accounts_distributor_id_fkey"
            columns: ["distributor_id"]
            isOneToOne: false
            referencedRelation: "distributors"
            referencedColumns: ["id"]
          },
        ]
      }
      app_admins: {
        Row: {
          created_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          user_id?: string
        }
        Relationships: []
      }
      app_user_access: {
        Row: {
          competitor: boolean
          created_at: string
          own_catalog: boolean
          playlist_watch: boolean
          playlist_watch_admin: boolean
          updated_at: string
          user_id: string
        }
        Insert: {
          competitor?: boolean
          created_at?: string
          own_catalog?: boolean
          playlist_watch?: boolean
          playlist_watch_admin?: boolean
          updated_at?: string
          user_id: string
        }
        Update: {
          competitor?: boolean
          created_at?: string
          own_catalog?: boolean
          playlist_watch?: boolean
          playlist_watch_admin?: boolean
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      artist_daily_stats: {
        Row: {
          artist_id: string
          artist_name: string | null
          date: string
          streams_cumulative: number
          track_count: number
          updated_at: string
        }
        Insert: {
          artist_id: string
          artist_name?: string | null
          date: string
          streams_cumulative?: number
          track_count?: number
          updated_at?: string
        }
        Update: {
          artist_id?: string
          artist_name?: string | null
          date?: string
          streams_cumulative?: number
          track_count?: number
          updated_at?: string
        }
        Relationships: []
      }
      artist_in_house_tags: {
        Row: {
          artist_id: string
          artist_name: string | null
          created_at: string
          created_by: string | null
          updated_at: string
        }
        Insert: {
          artist_id: string
          artist_name?: string | null
          created_at?: string
          created_by?: string | null
          updated_at?: string
        }
        Update: {
          artist_id?: string
          artist_name?: string | null
          created_at?: string
          created_by?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      collector_monthly_actual_revenue: {
        Row: {
          amount_usd: number
          collector: string
          created_at: string
          month: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          amount_usd: number
          collector: string
          created_at?: string
          month: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          amount_usd?: number
          collector?: string
          created_at?: string
          month?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      collector_monthly_revenue_forecasts: {
        Row: {
          amount_usd: number
          collector: string
          created_at: string
          month: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          amount_usd: number
          collector: string
          created_at?: string
          month: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          amount_usd?: number
          collector?: string
          created_at?: string
          month?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      concentration_share_snapshots: {
        Row: {
          created_at: string
          created_by: string | null
          expires_at: string
          id: string
          snapshot: Json
          token: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          expires_at?: string
          id?: string
          snapshot: Json
          token: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          expires_at?: string
          id?: string
          snapshot?: Json
          token?: string
        }
        Relationships: []
      }
      distributors: {
        Row: {
          created_at: string
          id: string
          name: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
        }
        Relationships: []
      }
      health_config: {
        Row: {
          description: string
          key: string
          updated_at: string
          value_numeric: number | null
        }
        Insert: {
          description?: string
          key: string
          updated_at?: string
          value_numeric?: number | null
        }
        Update: {
          description?: string
          key?: string
          updated_at?: string
          value_numeric?: number | null
        }
        Relationships: []
      }
      health_unplayable_track_exclusions: {
        Row: {
          created_at: string
          id: number
          isrc: string
          note: string | null
          playlist_key: string | null
        }
        Insert: {
          created_at?: string
          id?: number
          isrc: string
          note?: string | null
          playlist_key?: string | null
        }
        Update: {
          created_at?: string
          id?: number
          isrc?: string
          note?: string | null
          playlist_key?: string | null
        }
        Relationships: []
      }
      health_warning_exclusions: {
        Row: {
          code: string
          created_at: string
          id: number
          isrc: string
          note: string | null
          playlist_key: string | null
        }
        Insert: {
          code: string
          created_at?: string
          id?: number
          isrc: string
          note?: string | null
          playlist_key?: string | null
        }
        Update: {
          code?: string
          created_at?: string
          id?: number
          isrc?: string
          note?: string | null
          playlist_key?: string | null
        }
        Relationships: []
      }
      ingestion_runs: {
        Row: {
          commit_sha: string | null
          created_at: string
          exports_prefix: string | null
          finished_at: string | null
          id: string
          logs_url: string | null
          run_date: string
          started_at: string
          status: string
        }
        Insert: {
          commit_sha?: string | null
          created_at?: string
          exports_prefix?: string | null
          finished_at?: string | null
          id?: string
          logs_url?: string | null
          run_date: string
          started_at?: string
          status: string
        }
        Update: {
          commit_sha?: string | null
          created_at?: string
          exports_prefix?: string | null
          finished_at?: string | null
          id?: string
          logs_url?: string | null
          run_date?: string
          started_at?: string
          status?: string
        }
        Relationships: []
      }
      ingestion_warnings: {
        Row: {
          code: string
          created_at: string
          details_json: Json | null
          id: string
          message: string
          playlist_key: string | null
          run_date: string
          run_id: string | null
          severity: string
        }
        Insert: {
          code: string
          created_at?: string
          details_json?: Json | null
          id?: string
          message: string
          playlist_key?: string | null
          run_date: string
          run_id?: string | null
          severity: string
        }
        Update: {
          code?: string
          created_at?: string
          details_json?: Json | null
          id?: string
          message?: string
          playlist_key?: string | null
          run_date?: string
          run_id?: string | null
          severity?: string
        }
        Relationships: [
          {
            foreignKeyName: "ingestion_warnings_playlist_key_fkey"
            columns: ["playlist_key"]
            isOneToOne: false
            referencedRelation: "playlists"
            referencedColumns: ["playlist_key"]
          },
          {
            foreignKeyName: "ingestion_warnings_playlist_key_fkey"
            columns: ["playlist_key"]
            isOneToOne: false
            referencedRelation: "playlists_public"
            referencedColumns: ["playlist_key"]
          },
          {
            foreignKeyName: "ingestion_warnings_playlist_key_fkey"
            columns: ["playlist_key"]
            isOneToOne: false
            referencedRelation: "playlists_with_latest_stats_public"
            referencedColumns: ["playlist_key"]
          },
          {
            foreignKeyName: "ingestion_warnings_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "ingestion_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      isrc_aliases: {
        Row: {
          canonical_isrc: string
          created_at: string
          note: string | null
          old_isrc: string
        }
        Insert: {
          canonical_isrc: string
          created_at?: string
          note?: string | null
          old_isrc: string
        }
        Update: {
          canonical_isrc?: string
          created_at?: string
          note?: string | null
          old_isrc?: string
        }
        Relationships: [
          {
            foreignKeyName: "isrc_aliases_canonical_isrc_fkey"
            columns: ["canonical_isrc"]
            isOneToOne: false
            referencedRelation: "tracks"
            referencedColumns: ["isrc"]
          },
          {
            foreignKeyName: "isrc_aliases_canonical_isrc_fkey"
            columns: ["canonical_isrc"]
            isOneToOne: false
            referencedRelation: "tracks_public"
            referencedColumns: ["isrc"]
          },
        ]
      }
      playlist_daily_stats: {
        Row: {
          created_at: string
          daily_streams_net: number | null
          date: string
          est_revenue_daily_net: number | null
          est_revenue_total: number | null
          missing_streams_track_count: number
          playlist_key: string
          source_run_id: string | null
          total_streams_cumulative: number | null
          track_count: number
        }
        Insert: {
          created_at?: string
          daily_streams_net?: number | null
          date: string
          est_revenue_daily_net?: number | null
          est_revenue_total?: number | null
          missing_streams_track_count?: number
          playlist_key: string
          source_run_id?: string | null
          total_streams_cumulative?: number | null
          track_count?: number
        }
        Update: {
          created_at?: string
          daily_streams_net?: number | null
          date?: string
          est_revenue_daily_net?: number | null
          est_revenue_total?: number | null
          missing_streams_track_count?: number
          playlist_key?: string
          source_run_id?: string | null
          total_streams_cumulative?: number | null
          track_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "playlist_daily_stats_playlist_key_fk"
            columns: ["playlist_key"]
            isOneToOne: false
            referencedRelation: "playlists"
            referencedColumns: ["playlist_key"]
          },
          {
            foreignKeyName: "playlist_daily_stats_playlist_key_fk"
            columns: ["playlist_key"]
            isOneToOne: false
            referencedRelation: "playlists_public"
            referencedColumns: ["playlist_key"]
          },
          {
            foreignKeyName: "playlist_daily_stats_playlist_key_fk"
            columns: ["playlist_key"]
            isOneToOne: false
            referencedRelation: "playlists_with_latest_stats_public"
            referencedColumns: ["playlist_key"]
          },
          {
            foreignKeyName: "playlist_daily_stats_playlist_key_fkey"
            columns: ["playlist_key"]
            isOneToOne: false
            referencedRelation: "playlists"
            referencedColumns: ["playlist_key"]
          },
          {
            foreignKeyName: "playlist_daily_stats_playlist_key_fkey"
            columns: ["playlist_key"]
            isOneToOne: false
            referencedRelation: "playlists_public"
            referencedColumns: ["playlist_key"]
          },
          {
            foreignKeyName: "playlist_daily_stats_playlist_key_fkey"
            columns: ["playlist_key"]
            isOneToOne: false
            referencedRelation: "playlists_with_latest_stats_public"
            referencedColumns: ["playlist_key"]
          },
        ]
      }
      playlist_memberships: {
        Row: {
          created_at: string
          id: string
          isrc: string
          playlist_key: string
          valid_from: string
          valid_to: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          isrc: string
          playlist_key: string
          valid_from: string
          valid_to?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          isrc?: string
          playlist_key?: string
          valid_from?: string
          valid_to?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "playlist_memberships_isrc_fk"
            columns: ["isrc"]
            isOneToOne: false
            referencedRelation: "tracks"
            referencedColumns: ["isrc"]
          },
          {
            foreignKeyName: "playlist_memberships_isrc_fk"
            columns: ["isrc"]
            isOneToOne: false
            referencedRelation: "tracks_public"
            referencedColumns: ["isrc"]
          },
          {
            foreignKeyName: "playlist_memberships_isrc_fkey"
            columns: ["isrc"]
            isOneToOne: false
            referencedRelation: "tracks"
            referencedColumns: ["isrc"]
          },
          {
            foreignKeyName: "playlist_memberships_isrc_fkey"
            columns: ["isrc"]
            isOneToOne: false
            referencedRelation: "tracks_public"
            referencedColumns: ["isrc"]
          },
          {
            foreignKeyName: "playlist_memberships_playlist_key_fk"
            columns: ["playlist_key"]
            isOneToOne: false
            referencedRelation: "playlists"
            referencedColumns: ["playlist_key"]
          },
          {
            foreignKeyName: "playlist_memberships_playlist_key_fk"
            columns: ["playlist_key"]
            isOneToOne: false
            referencedRelation: "playlists_public"
            referencedColumns: ["playlist_key"]
          },
          {
            foreignKeyName: "playlist_memberships_playlist_key_fk"
            columns: ["playlist_key"]
            isOneToOne: false
            referencedRelation: "playlists_with_latest_stats_public"
            referencedColumns: ["playlist_key"]
          },
          {
            foreignKeyName: "playlist_memberships_playlist_key_fkey"
            columns: ["playlist_key"]
            isOneToOne: false
            referencedRelation: "playlists"
            referencedColumns: ["playlist_key"]
          },
          {
            foreignKeyName: "playlist_memberships_playlist_key_fkey"
            columns: ["playlist_key"]
            isOneToOne: false
            referencedRelation: "playlists_public"
            referencedColumns: ["playlist_key"]
          },
          {
            foreignKeyName: "playlist_memberships_playlist_key_fkey"
            columns: ["playlist_key"]
            isOneToOne: false
            referencedRelation: "playlists_with_latest_stats_public"
            referencedColumns: ["playlist_key"]
          },
        ]
      }
      playlists: {
        Row: {
          collector: string | null
          created_at: string
          dashboard_url: string | null
          display_name: string
          display_order: number | null
          entity_playlist_key: string | null
          is_catalog: boolean
          playlist_key: string
          playlist_type: string | null
          spotify_last_fetched_at: string | null
          spotify_playlist_id: string | null
          spotify_playlist_image_url: string | null
          spotify_playlist_name: string | null
        }
        Insert: {
          collector?: string | null
          created_at?: string
          dashboard_url?: string | null
          display_name: string
          display_order?: number | null
          entity_playlist_key?: string | null
          is_catalog?: boolean
          playlist_key: string
          playlist_type?: string | null
          spotify_last_fetched_at?: string | null
          spotify_playlist_id?: string | null
          spotify_playlist_image_url?: string | null
          spotify_playlist_name?: string | null
        }
        Update: {
          collector?: string | null
          created_at?: string
          dashboard_url?: string | null
          display_name?: string
          display_order?: number | null
          entity_playlist_key?: string | null
          is_catalog?: boolean
          playlist_key?: string
          playlist_type?: string | null
          spotify_last_fetched_at?: string | null
          spotify_playlist_id?: string | null
          spotify_playlist_image_url?: string | null
          spotify_playlist_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "playlists_entity_playlist_key_fkey"
            columns: ["entity_playlist_key"]
            isOneToOne: false
            referencedRelation: "playlists"
            referencedColumns: ["playlist_key"]
          },
          {
            foreignKeyName: "playlists_entity_playlist_key_fkey"
            columns: ["entity_playlist_key"]
            isOneToOne: false
            referencedRelation: "playlists_public"
            referencedColumns: ["playlist_key"]
          },
          {
            foreignKeyName: "playlists_entity_playlist_key_fkey"
            columns: ["entity_playlist_key"]
            isOneToOne: false
            referencedRelation: "playlists_with_latest_stats_public"
            referencedColumns: ["playlist_key"]
          },
        ]
      }
      raw_exports: {
        Row: {
          created_at: string
          exported_at: string | null
          file_sha256: string | null
          id: string
          object_key: string | null
          playlist_key: string
          rows_count: number | null
          run_id: string
          storage_bucket: string | null
          storage_prefix: string | null
        }
        Insert: {
          created_at?: string
          exported_at?: string | null
          file_sha256?: string | null
          id?: string
          object_key?: string | null
          playlist_key: string
          rows_count?: number | null
          run_id: string
          storage_bucket?: string | null
          storage_prefix?: string | null
        }
        Update: {
          created_at?: string
          exported_at?: string | null
          file_sha256?: string | null
          id?: string
          object_key?: string | null
          playlist_key?: string
          rows_count?: number | null
          run_id?: string
          storage_bucket?: string | null
          storage_prefix?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "raw_exports_playlist_key_fkey"
            columns: ["playlist_key"]
            isOneToOne: false
            referencedRelation: "playlists"
            referencedColumns: ["playlist_key"]
          },
          {
            foreignKeyName: "raw_exports_playlist_key_fkey"
            columns: ["playlist_key"]
            isOneToOne: false
            referencedRelation: "playlists_public"
            referencedColumns: ["playlist_key"]
          },
          {
            foreignKeyName: "raw_exports_playlist_key_fkey"
            columns: ["playlist_key"]
            isOneToOne: false
            referencedRelation: "playlists_with_latest_stats_public"
            referencedColumns: ["playlist_key"]
          },
          {
            foreignKeyName: "raw_exports_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "ingestion_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      revenue_entries: {
        Row: {
          artist: string | null
          collected_by: string | null
          created_at: string
          currency: string
          customer_territory: string | null
          fee_adjusted_amount: number
          fee_adjusted_usd_amount: number
          fee_amount: number
          fee_percentage: number
          id: string
          isrc: string | null
          platform: string | null
          quantity: number | null
          release_title: string | null
          revenue_amount: number
          royalty_date: string | null
          track_title: string | null
          upc: string | null
          upload_id: string
          usd_amount: number
        }
        Insert: {
          artist?: string | null
          collected_by?: string | null
          created_at?: string
          currency?: string
          customer_territory?: string | null
          fee_adjusted_amount?: number
          fee_adjusted_usd_amount?: number
          fee_amount?: number
          fee_percentage?: number
          id?: string
          isrc?: string | null
          platform?: string | null
          quantity?: number | null
          release_title?: string | null
          revenue_amount?: number
          royalty_date?: string | null
          track_title?: string | null
          upc?: string | null
          upload_id: string
          usd_amount?: number
        }
        Update: {
          artist?: string | null
          collected_by?: string | null
          created_at?: string
          currency?: string
          customer_territory?: string | null
          fee_adjusted_amount?: number
          fee_adjusted_usd_amount?: number
          fee_amount?: number
          fee_percentage?: number
          id?: string
          isrc?: string | null
          platform?: string | null
          quantity?: number | null
          release_title?: string | null
          revenue_amount?: number
          royalty_date?: string | null
          track_title?: string | null
          upc?: string | null
          upload_id?: string
          usd_amount?: number
        }
        Relationships: [
          {
            foreignKeyName: "revenue_entries_upload_id_fkey"
            columns: ["upload_id"]
            isOneToOne: false
            referencedRelation: "uploads"
            referencedColumns: ["id"]
          },
        ]
      }
      sai_conversations: {
        Row: {
          created_at: string
          deleted_at: string | null
          id: string
          title: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          deleted_at?: string | null
          id?: string
          title?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          id?: string
          title?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      sai_doc_chunks: {
        Row: {
          chunk_id: string
          content_md: string
          content_sha256: string
          content_text: string
          created_at: string
          doc_path: string
          embedding: string
          id: string
          sources: string[]
          tags: string[]
          title: string
          updated_at: string
        }
        Insert: {
          chunk_id: string
          content_md: string
          content_sha256: string
          content_text: string
          created_at?: string
          doc_path: string
          embedding: string
          id?: string
          sources?: string[]
          tags?: string[]
          title: string
          updated_at?: string
        }
        Update: {
          chunk_id?: string
          content_md?: string
          content_sha256?: string
          content_text?: string
          created_at?: string
          doc_path?: string
          embedding?: string
          id?: string
          sources?: string[]
          tags?: string[]
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      sai_messages: {
        Row: {
          content: string
          conversation_id: string
          created_at: string
          id: string
          meta: Json
          role: string
          user_id: string
        }
        Insert: {
          content?: string
          conversation_id: string
          created_at?: string
          id?: string
          meta?: Json
          role: string
          user_id: string
        }
        Update: {
          content?: string
          conversation_id?: string
          created_at?: string
          id?: string
          meta?: Json
          role?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "sai_messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "sai_conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      saved_filters: {
        Row: {
          config: Json
          created_at: string
          entity_type: string
          id: string
          name: string
          updated_at: string
          user_id: string
        }
        Insert: {
          config: Json
          created_at?: string
          entity_type: string
          id?: string
          name: string
          updated_at?: string
          user_id: string
        }
        Update: {
          config?: Json
          created_at?: string
          entity_type?: string
          id?: string
          name?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      spotify_artist_images: {
        Row: {
          artist_id: string
          external_url: string | null
          image_url: string | null
          name: string | null
          refreshed_at: string
        }
        Insert: {
          artist_id: string
          external_url?: string | null
          image_url?: string | null
          name?: string | null
          refreshed_at?: string
        }
        Update: {
          artist_id?: string
          external_url?: string | null
          image_url?: string | null
          name?: string | null
          refreshed_at?: string
        }
        Relationships: []
      }
      stream_lookup_results: {
        Row: {
          context: string
          created_at: string
          error: string | null
          isrc: string
          lookup_date: string
          provider: string
          stale_streams: number | null
          status: string
          streams: number | null
          updated_at: string
        }
        Insert: {
          context?: string
          created_at?: string
          error?: string | null
          isrc: string
          lookup_date: string
          provider: string
          stale_streams?: number | null
          status: string
          streams?: number | null
          updated_at?: string
        }
        Update: {
          context?: string
          created_at?: string
          error?: string | null
          isrc?: string
          lookup_date?: string
          provider?: string
          stale_streams?: number | null
          status?: string
          streams?: number | null
          updated_at?: string
        }
        Relationships: []
      }
      stream_lookup_usage: {
        Row: {
          calls: number
          provider: string
          updated_at: string
          usage_date: string
        }
        Insert: {
          calls?: number
          provider: string
          updated_at?: string
          usage_date: string
        }
        Update: {
          calls?: number
          provider?: string
          updated_at?: string
          usage_date?: string
        }
        Relationships: []
      }
      track_daily_stream_overrides: {
        Row: {
          created_at: string
          created_by: string | null
          date: string
          id: number
          isrc: string
          note: string | null
          streams_cumulative_override: number
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          date: string
          id?: number
          isrc: string
          note?: string | null
          streams_cumulative_override: number
        }
        Update: {
          created_at?: string
          created_by?: string | null
          date?: string
          id?: number
          isrc?: string
          note?: string | null
          streams_cumulative_override?: number
        }
        Relationships: [
          {
            foreignKeyName: "track_daily_stream_overrides_isrc_fk"
            columns: ["isrc"]
            isOneToOne: false
            referencedRelation: "tracks"
            referencedColumns: ["isrc"]
          },
          {
            foreignKeyName: "track_daily_stream_overrides_isrc_fk"
            columns: ["isrc"]
            isOneToOne: false
            referencedRelation: "tracks_public"
            referencedColumns: ["isrc"]
          },
        ]
      }
      track_daily_streams: {
        Row: {
          created_at: string | null
          date: string
          isrc: string
          source_run_id: string | null
          streams_cumulative: number | null
        }
        Insert: {
          created_at?: string | null
          date: string
          isrc: string
          source_run_id?: string | null
          streams_cumulative?: number | null
        }
        Update: {
          created_at?: string | null
          date?: string
          isrc?: string
          source_run_id?: string | null
          streams_cumulative?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "track_daily_streams_isrc_fkey"
            columns: ["isrc"]
            isOneToOne: false
            referencedRelation: "tracks"
            referencedColumns: ["isrc"]
          },
          {
            foreignKeyName: "track_daily_streams_isrc_fkey"
            columns: ["isrc"]
            isOneToOne: false
            referencedRelation: "tracks_public"
            referencedColumns: ["isrc"]
          },
        ]
      }
      track_daily_streams_y2026m01: {
        Row: {
          created_at: string | null
          date: string
          isrc: string
          source_run_id: string | null
          streams_cumulative: number | null
        }
        Insert: {
          created_at?: string | null
          date: string
          isrc: string
          source_run_id?: string | null
          streams_cumulative?: number | null
        }
        Update: {
          created_at?: string | null
          date?: string
          isrc?: string
          source_run_id?: string | null
          streams_cumulative?: number | null
        }
        Relationships: []
      }
      track_daily_streams_y2026m02: {
        Row: {
          created_at: string | null
          date: string
          isrc: string
          source_run_id: string | null
          streams_cumulative: number | null
        }
        Insert: {
          created_at?: string | null
          date: string
          isrc: string
          source_run_id?: string | null
          streams_cumulative?: number | null
        }
        Update: {
          created_at?: string | null
          date?: string
          isrc?: string
          source_run_id?: string | null
          streams_cumulative?: number | null
        }
        Relationships: []
      }
      track_daily_streams_y2026m03: {
        Row: {
          created_at: string | null
          date: string
          isrc: string
          source_run_id: string | null
          streams_cumulative: number | null
        }
        Insert: {
          created_at?: string | null
          date: string
          isrc: string
          source_run_id?: string | null
          streams_cumulative?: number | null
        }
        Update: {
          created_at?: string | null
          date?: string
          isrc?: string
          source_run_id?: string | null
          streams_cumulative?: number | null
        }
        Relationships: []
      }
      track_daily_streams_y2026m04: {
        Row: {
          created_at: string | null
          date: string
          isrc: string
          source_run_id: string | null
          streams_cumulative: number | null
        }
        Insert: {
          created_at?: string | null
          date: string
          isrc: string
          source_run_id?: string | null
          streams_cumulative?: number | null
        }
        Update: {
          created_at?: string | null
          date?: string
          isrc?: string
          source_run_id?: string | null
          streams_cumulative?: number | null
        }
        Relationships: []
      }
      track_daily_streams_y2026m05: {
        Row: {
          created_at: string | null
          date: string
          isrc: string
          source_run_id: string | null
          streams_cumulative: number | null
        }
        Insert: {
          created_at?: string | null
          date: string
          isrc: string
          source_run_id?: string | null
          streams_cumulative?: number | null
        }
        Update: {
          created_at?: string | null
          date?: string
          isrc?: string
          source_run_id?: string | null
          streams_cumulative?: number | null
        }
        Relationships: []
      }
      track_daily_streams_y2026m06: {
        Row: {
          created_at: string | null
          date: string
          isrc: string
          source_run_id: string | null
          streams_cumulative: number | null
        }
        Insert: {
          created_at?: string | null
          date: string
          isrc: string
          source_run_id?: string | null
          streams_cumulative?: number | null
        }
        Update: {
          created_at?: string | null
          date?: string
          isrc?: string
          source_run_id?: string | null
          streams_cumulative?: number | null
        }
        Relationships: []
      }
      track_daily_streams_y2026m07: {
        Row: {
          created_at: string | null
          date: string
          isrc: string
          source_run_id: string | null
          streams_cumulative: number | null
        }
        Insert: {
          created_at?: string | null
          date: string
          isrc: string
          source_run_id?: string | null
          streams_cumulative?: number | null
        }
        Update: {
          created_at?: string | null
          date?: string
          isrc?: string
          source_run_id?: string | null
          streams_cumulative?: number | null
        }
        Relationships: []
      }
      track_daily_streams_y2026m08: {
        Row: {
          created_at: string | null
          date: string
          isrc: string
          source_run_id: string | null
          streams_cumulative: number | null
        }
        Insert: {
          created_at?: string | null
          date: string
          isrc: string
          source_run_id?: string | null
          streams_cumulative?: number | null
        }
        Update: {
          created_at?: string | null
          date?: string
          isrc?: string
          source_run_id?: string | null
          streams_cumulative?: number | null
        }
        Relationships: []
      }
      track_daily_streams_y2026m09: {
        Row: {
          created_at: string | null
          date: string
          isrc: string
          source_run_id: string | null
          streams_cumulative: number | null
        }
        Insert: {
          created_at?: string | null
          date: string
          isrc: string
          source_run_id?: string | null
          streams_cumulative?: number | null
        }
        Update: {
          created_at?: string | null
          date?: string
          isrc?: string
          source_run_id?: string | null
          streams_cumulative?: number | null
        }
        Relationships: []
      }
      track_daily_streams_y2026m10: {
        Row: {
          created_at: string | null
          date: string
          isrc: string
          source_run_id: string | null
          streams_cumulative: number | null
        }
        Insert: {
          created_at?: string | null
          date: string
          isrc: string
          source_run_id?: string | null
          streams_cumulative?: number | null
        }
        Update: {
          created_at?: string | null
          date?: string
          isrc?: string
          source_run_id?: string | null
          streams_cumulative?: number | null
        }
        Relationships: []
      }
      track_daily_streams_y2026m11: {
        Row: {
          created_at: string | null
          date: string
          isrc: string
          source_run_id: string | null
          streams_cumulative: number | null
        }
        Insert: {
          created_at?: string | null
          date: string
          isrc: string
          source_run_id?: string | null
          streams_cumulative?: number | null
        }
        Update: {
          created_at?: string | null
          date?: string
          isrc?: string
          source_run_id?: string | null
          streams_cumulative?: number | null
        }
        Relationships: []
      }
      track_daily_streams_y2026m12: {
        Row: {
          created_at: string | null
          date: string
          isrc: string
          source_run_id: string | null
          streams_cumulative: number | null
        }
        Insert: {
          created_at?: string | null
          date: string
          isrc: string
          source_run_id?: string | null
          streams_cumulative?: number | null
        }
        Update: {
          created_at?: string | null
          date?: string
          isrc?: string
          source_run_id?: string | null
          streams_cumulative?: number | null
        }
        Relationships: []
      }
      track_daily_streams_y2027m01: {
        Row: {
          created_at: string | null
          date: string
          isrc: string
          source_run_id: string | null
          streams_cumulative: number | null
        }
        Insert: {
          created_at?: string | null
          date: string
          isrc: string
          source_run_id?: string | null
          streams_cumulative?: number | null
        }
        Update: {
          created_at?: string | null
          date?: string
          isrc?: string
          source_run_id?: string | null
          streams_cumulative?: number | null
        }
        Relationships: []
      }
      track_daily_streams_y2027m02: {
        Row: {
          created_at: string | null
          date: string
          isrc: string
          source_run_id: string | null
          streams_cumulative: number | null
        }
        Insert: {
          created_at?: string | null
          date: string
          isrc: string
          source_run_id?: string | null
          streams_cumulative?: number | null
        }
        Update: {
          created_at?: string | null
          date?: string
          isrc?: string
          source_run_id?: string | null
          streams_cumulative?: number | null
        }
        Relationships: []
      }
      track_daily_streams_y2027m03: {
        Row: {
          created_at: string | null
          date: string
          isrc: string
          source_run_id: string | null
          streams_cumulative: number | null
        }
        Insert: {
          created_at?: string | null
          date: string
          isrc: string
          source_run_id?: string | null
          streams_cumulative?: number | null
        }
        Update: {
          created_at?: string | null
          date?: string
          isrc?: string
          source_run_id?: string | null
          streams_cumulative?: number | null
        }
        Relationships: []
      }
      track_daily_streams_y2027m04: {
        Row: {
          created_at: string | null
          date: string
          isrc: string
          source_run_id: string | null
          streams_cumulative: number | null
        }
        Insert: {
          created_at?: string | null
          date: string
          isrc: string
          source_run_id?: string | null
          streams_cumulative?: number | null
        }
        Update: {
          created_at?: string | null
          date?: string
          isrc?: string
          source_run_id?: string | null
          streams_cumulative?: number | null
        }
        Relationships: []
      }
      track_daily_streams_y2027m05: {
        Row: {
          created_at: string | null
          date: string
          isrc: string
          source_run_id: string | null
          streams_cumulative: number | null
        }
        Insert: {
          created_at?: string | null
          date: string
          isrc: string
          source_run_id?: string | null
          streams_cumulative?: number | null
        }
        Update: {
          created_at?: string | null
          date?: string
          isrc?: string
          source_run_id?: string | null
          streams_cumulative?: number | null
        }
        Relationships: []
      }
      track_daily_streams_y2027m06: {
        Row: {
          created_at: string | null
          date: string
          isrc: string
          source_run_id: string | null
          streams_cumulative: number | null
        }
        Insert: {
          created_at?: string | null
          date: string
          isrc: string
          source_run_id?: string | null
          streams_cumulative?: number | null
        }
        Update: {
          created_at?: string | null
          date?: string
          isrc?: string
          source_run_id?: string | null
          streams_cumulative?: number | null
        }
        Relationships: []
      }
      track_daily_streams_y2027m07: {
        Row: {
          created_at: string | null
          date: string
          isrc: string
          source_run_id: string | null
          streams_cumulative: number | null
        }
        Insert: {
          created_at?: string | null
          date: string
          isrc: string
          source_run_id?: string | null
          streams_cumulative?: number | null
        }
        Update: {
          created_at?: string | null
          date?: string
          isrc?: string
          source_run_id?: string | null
          streams_cumulative?: number | null
        }
        Relationships: []
      }
      track_daily_streams_y2027m08: {
        Row: {
          created_at: string | null
          date: string
          isrc: string
          source_run_id: string | null
          streams_cumulative: number | null
        }
        Insert: {
          created_at?: string | null
          date: string
          isrc: string
          source_run_id?: string | null
          streams_cumulative?: number | null
        }
        Update: {
          created_at?: string | null
          date?: string
          isrc?: string
          source_run_id?: string | null
          streams_cumulative?: number | null
        }
        Relationships: []
      }
      track_daily_streams_y2027m09: {
        Row: {
          created_at: string | null
          date: string
          isrc: string
          source_run_id: string | null
          streams_cumulative: number | null
        }
        Insert: {
          created_at?: string | null
          date: string
          isrc: string
          source_run_id?: string | null
          streams_cumulative?: number | null
        }
        Update: {
          created_at?: string | null
          date?: string
          isrc?: string
          source_run_id?: string | null
          streams_cumulative?: number | null
        }
        Relationships: []
      }
      track_daily_streams_y2027m10: {
        Row: {
          created_at: string | null
          date: string
          isrc: string
          source_run_id: string | null
          streams_cumulative: number | null
        }
        Insert: {
          created_at?: string | null
          date: string
          isrc: string
          source_run_id?: string | null
          streams_cumulative?: number | null
        }
        Update: {
          created_at?: string | null
          date?: string
          isrc?: string
          source_run_id?: string | null
          streams_cumulative?: number | null
        }
        Relationships: []
      }
      track_daily_streams_y2027m11: {
        Row: {
          created_at: string | null
          date: string
          isrc: string
          source_run_id: string | null
          streams_cumulative: number | null
        }
        Insert: {
          created_at?: string | null
          date: string
          isrc: string
          source_run_id?: string | null
          streams_cumulative?: number | null
        }
        Update: {
          created_at?: string | null
          date?: string
          isrc?: string
          source_run_id?: string | null
          streams_cumulative?: number | null
        }
        Relationships: []
      }
      track_daily_streams_y2027m12: {
        Row: {
          created_at: string | null
          date: string
          isrc: string
          source_run_id: string | null
          streams_cumulative: number | null
        }
        Insert: {
          created_at?: string | null
          date: string
          isrc: string
          source_run_id?: string | null
          streams_cumulative?: number | null
        }
        Update: {
          created_at?: string | null
          date?: string
          isrc?: string
          source_run_id?: string | null
          streams_cumulative?: number | null
        }
        Relationships: []
      }
      tracks: {
        Row: {
          created_at: string
          first_seen: string | null
          isrc: string
          last_seen: string | null
          name: string | null
          release_date: string | null
          spotify_album_id: string | null
          spotify_album_image_url: string | null
          spotify_album_name: string | null
          spotify_artist_ids: string[] | null
          spotify_artist_names: string[] | null
          spotify_last_fetched_at: string | null
          spotify_track_id: string | null
        }
        Insert: {
          created_at?: string
          first_seen?: string | null
          isrc: string
          last_seen?: string | null
          name?: string | null
          release_date?: string | null
          spotify_album_id?: string | null
          spotify_album_image_url?: string | null
          spotify_album_name?: string | null
          spotify_artist_ids?: string[] | null
          spotify_artist_names?: string[] | null
          spotify_last_fetched_at?: string | null
          spotify_track_id?: string | null
        }
        Update: {
          created_at?: string
          first_seen?: string | null
          isrc?: string
          last_seen?: string | null
          name?: string | null
          release_date?: string | null
          spotify_album_id?: string | null
          spotify_album_image_url?: string | null
          spotify_album_name?: string | null
          spotify_artist_ids?: string[] | null
          spotify_artist_names?: string[] | null
          spotify_last_fetched_at?: string | null
          spotify_track_id?: string | null
        }
        Relationships: []
      }
      uploads: {
        Row: {
          account_id: string
          collected_by: string | null
          created_at: string
          currency: string
          distributor_id: string
          fee_amount: number
          fee_percentage: number
          fee_usd_amount: number | null
          file_name: string
          file_path: string | null
          gross_revenue: number
          gross_usd_revenue: number | null
          id: string
          net_revenue: number
          net_usd_revenue: number | null
          row_count: number
          status: string
          uploaded_at: string
        }
        Insert: {
          account_id: string
          collected_by?: string | null
          created_at?: string
          currency?: string
          distributor_id: string
          fee_amount?: number
          fee_percentage?: number
          fee_usd_amount?: number | null
          file_name: string
          file_path?: string | null
          gross_revenue?: number
          gross_usd_revenue?: number | null
          id?: string
          net_revenue?: number
          net_usd_revenue?: number | null
          row_count?: number
          status?: string
          uploaded_at?: string
        }
        Update: {
          account_id?: string
          collected_by?: string | null
          created_at?: string
          currency?: string
          distributor_id?: string
          fee_amount?: number
          fee_percentage?: number
          fee_usd_amount?: number | null
          file_name?: string
          file_path?: string | null
          gross_revenue?: number
          gross_usd_revenue?: number | null
          id?: string
          net_revenue?: number
          net_usd_revenue?: number | null
          row_count?: number
          status?: string
          uploaded_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "uploads_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "uploads_distributor_id_fkey"
            columns: ["distributor_id"]
            isOneToOne: false
            referencedRelation: "distributors"
            referencedColumns: ["id"]
          },
        ]
      }
      user_settings: {
        Row: {
          artificial_streams_include_weekends_user: boolean | null
          artificial_streams_spike_ratio: number | null
          chart_start_date: string | null
          chart_week_highlight_day: number
          chart_zoom_daily_y_axis: boolean
          chart_zoom_daily_y_axis_collector_comparison: boolean
          collector_entity_playlist_stats_enabled: boolean
          competitor_label_key: string | null
          created_at: string
          currency_display: string
          dataset_mode: string
          hide_stale_annotations_exclude_catalog: boolean
          hide_stale_override_annotations: boolean
          home_artificial_spikes_section_enabled: boolean
          home_custom_milestones_streams: string | null
          home_filters_enabled: boolean
          id: number
          rapidapi_auto_fix_enabled: boolean
          sai_enabled: boolean
          stale_track_min_avg_daily: number
          stale_track_min_streams: number
          stream_payout_rate_per_k_usd: number
          updated_at: string
          user_id: string
        }
        Insert: {
          artificial_streams_include_weekends_user?: boolean | null
          artificial_streams_spike_ratio?: number | null
          chart_start_date?: string | null
          chart_week_highlight_day?: number
          chart_zoom_daily_y_axis?: boolean
          chart_zoom_daily_y_axis_collector_comparison?: boolean
          collector_entity_playlist_stats_enabled?: boolean
          competitor_label_key?: string | null
          created_at?: string
          currency_display?: string
          dataset_mode?: string
          hide_stale_annotations_exclude_catalog?: boolean
          hide_stale_override_annotations?: boolean
          home_artificial_spikes_section_enabled?: boolean
          home_custom_milestones_streams?: string | null
          home_filters_enabled?: boolean
          id?: never
          rapidapi_auto_fix_enabled?: boolean
          sai_enabled?: boolean
          stale_track_min_avg_daily?: number
          stale_track_min_streams?: number
          stream_payout_rate_per_k_usd?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          artificial_streams_include_weekends_user?: boolean | null
          artificial_streams_spike_ratio?: number | null
          chart_start_date?: string | null
          chart_week_highlight_day?: number
          chart_zoom_daily_y_axis?: boolean
          chart_zoom_daily_y_axis_collector_comparison?: boolean
          collector_entity_playlist_stats_enabled?: boolean
          competitor_label_key?: string | null
          created_at?: string
          currency_display?: string
          dataset_mode?: string
          hide_stale_annotations_exclude_catalog?: boolean
          hide_stale_override_annotations?: boolean
          home_artificial_spikes_section_enabled?: boolean
          home_custom_milestones_streams?: string | null
          home_filters_enabled?: boolean
          id?: never
          rapidapi_auto_fix_enabled?: boolean
          sai_enabled?: boolean
          stale_track_min_avg_daily?: number
          stale_track_min_streams?: number
          stream_payout_rate_per_k_usd?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      web_performance_metrics: {
        Row: {
          dataset_mode: string | null
          id: number
          metadata: Json
          metric_name: string
          metric_unit: string
          metric_value: number
          recorded_at: string
          route: string
          user_agent_family: string | null
          user_id: string | null
        }
        Insert: {
          dataset_mode?: string | null
          id?: never
          metadata?: Json
          metric_name: string
          metric_unit?: string
          metric_value: number
          recorded_at?: string
          route: string
          user_agent_family?: string | null
          user_id?: string | null
        }
        Update: {
          dataset_mode?: string | null
          id?: never
          metadata?: Json
          metric_name?: string
          metric_unit?: string
          metric_value?: number
          recorded_at?: string
          route?: string
          user_agent_family?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      collector_daily_agg: {
        Row: {
          collector: string | null
          daily_streams_net: number | null
          date: string | null
          est_revenue_daily_net: number | null
          est_revenue_total: number | null
          missing_streams_track_count: number | null
          total_streams_cumulative: number | null
          track_count: number | null
        }
        Relationships: []
      }
      collector_daily_agg_entity_playlists: {
        Row: {
          collector: string | null
          daily_streams_net: number | null
          date: string | null
          est_revenue_daily_net: number | null
          est_revenue_total: number | null
          missing_streams_track_count: number | null
          total_streams_cumulative: number | null
          track_count: number | null
        }
        Relationships: []
      }
      collector_daily_agg_public: {
        Row: {
          collector: string | null
          daily_streams_net: number | null
          date: string | null
          est_revenue_daily_net: number | null
          est_revenue_total: number | null
          missing_streams_track_count: number | null
          total_streams_cumulative: number | null
          track_count: number | null
        }
        Relationships: []
      }
      collector_daily_compare: {
        Row: {
          collector: string | null
          daily_streams_delta_ma7: number | null
          daily_streams_delta_yday: number | null
          daily_streams_ma7_prev: number | null
          daily_streams_net: number | null
          date: string | null
          est_revenue_daily_delta_ma7: number | null
          est_revenue_daily_delta_yday: number | null
          est_revenue_daily_ma7_prev: number | null
          est_revenue_daily_net: number | null
          est_revenue_total: number | null
          missing_streams_track_count: number | null
          total_streams_cumulative: number | null
          track_count: number | null
          track_count_delta_ma7: number | null
          track_count_delta_yday: number | null
          track_count_ma7_prev: number | null
        }
        Relationships: []
      }
      collector_daily_compare_entity_playlists: {
        Row: {
          collector: string | null
          daily_streams_delta_ma7: number | null
          daily_streams_delta_yday: number | null
          daily_streams_ma7_prev: number | null
          daily_streams_net: number | null
          date: string | null
          est_revenue_daily_delta_ma7: number | null
          est_revenue_daily_delta_yday: number | null
          est_revenue_daily_ma7_prev: number | null
          est_revenue_daily_net: number | null
          est_revenue_total: number | null
          missing_streams_track_count: number | null
          total_streams_cumulative: number | null
          track_count: number | null
          track_count_delta_ma7: number | null
          track_count_delta_yday: number | null
          track_count_ma7_prev: number | null
        }
        Relationships: []
      }
      collector_stats_overview_mv: {
        Row: {
          accounts_count: number | null
          collector: string | null
          distributors_count: number | null
          latest_spotify_date: string | null
          total_revenue: number | null
          total_streams: number | null
          unique_artists: number | null
          unique_tracks: number | null
        }
        Relationships: []
      }
      health_warning_history_mv: {
        Row: {
          code: string | null
          run_date: string | null
          severity: string | null
          warning_count: number | null
        }
        Relationships: []
      }
      playlist_daily_stats_public: {
        Row: {
          daily_streams_net: number | null
          date: string | null
          est_revenue_daily_net: number | null
          missing_streams_track_count: number | null
          playlist_key: string | null
          total_streams_cumulative: number | null
          track_count: number | null
        }
        Insert: {
          daily_streams_net?: number | null
          date?: string | null
          est_revenue_daily_net?: number | null
          missing_streams_track_count?: number | null
          playlist_key?: string | null
          total_streams_cumulative?: number | null
          track_count?: number | null
        }
        Update: {
          daily_streams_net?: number | null
          date?: string | null
          est_revenue_daily_net?: number | null
          missing_streams_track_count?: number | null
          playlist_key?: string | null
          total_streams_cumulative?: number | null
          track_count?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "playlist_daily_stats_playlist_key_fk"
            columns: ["playlist_key"]
            isOneToOne: false
            referencedRelation: "playlists"
            referencedColumns: ["playlist_key"]
          },
          {
            foreignKeyName: "playlist_daily_stats_playlist_key_fk"
            columns: ["playlist_key"]
            isOneToOne: false
            referencedRelation: "playlists_public"
            referencedColumns: ["playlist_key"]
          },
          {
            foreignKeyName: "playlist_daily_stats_playlist_key_fk"
            columns: ["playlist_key"]
            isOneToOne: false
            referencedRelation: "playlists_with_latest_stats_public"
            referencedColumns: ["playlist_key"]
          },
          {
            foreignKeyName: "playlist_daily_stats_playlist_key_fkey"
            columns: ["playlist_key"]
            isOneToOne: false
            referencedRelation: "playlists"
            referencedColumns: ["playlist_key"]
          },
          {
            foreignKeyName: "playlist_daily_stats_playlist_key_fkey"
            columns: ["playlist_key"]
            isOneToOne: false
            referencedRelation: "playlists_public"
            referencedColumns: ["playlist_key"]
          },
          {
            foreignKeyName: "playlist_daily_stats_playlist_key_fkey"
            columns: ["playlist_key"]
            isOneToOne: false
            referencedRelation: "playlists_with_latest_stats_public"
            referencedColumns: ["playlist_key"]
          },
        ]
      }
      playlist_memberships_public: {
        Row: {
          isrc: string | null
          playlist_key: string | null
          valid_from: string | null
          valid_to: string | null
        }
        Insert: {
          isrc?: string | null
          playlist_key?: string | null
          valid_from?: string | null
          valid_to?: string | null
        }
        Update: {
          isrc?: string | null
          playlist_key?: string | null
          valid_from?: string | null
          valid_to?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "playlist_memberships_isrc_fk"
            columns: ["isrc"]
            isOneToOne: false
            referencedRelation: "tracks"
            referencedColumns: ["isrc"]
          },
          {
            foreignKeyName: "playlist_memberships_isrc_fk"
            columns: ["isrc"]
            isOneToOne: false
            referencedRelation: "tracks_public"
            referencedColumns: ["isrc"]
          },
          {
            foreignKeyName: "playlist_memberships_isrc_fkey"
            columns: ["isrc"]
            isOneToOne: false
            referencedRelation: "tracks"
            referencedColumns: ["isrc"]
          },
          {
            foreignKeyName: "playlist_memberships_isrc_fkey"
            columns: ["isrc"]
            isOneToOne: false
            referencedRelation: "tracks_public"
            referencedColumns: ["isrc"]
          },
          {
            foreignKeyName: "playlist_memberships_playlist_key_fk"
            columns: ["playlist_key"]
            isOneToOne: false
            referencedRelation: "playlists"
            referencedColumns: ["playlist_key"]
          },
          {
            foreignKeyName: "playlist_memberships_playlist_key_fk"
            columns: ["playlist_key"]
            isOneToOne: false
            referencedRelation: "playlists_public"
            referencedColumns: ["playlist_key"]
          },
          {
            foreignKeyName: "playlist_memberships_playlist_key_fk"
            columns: ["playlist_key"]
            isOneToOne: false
            referencedRelation: "playlists_with_latest_stats_public"
            referencedColumns: ["playlist_key"]
          },
          {
            foreignKeyName: "playlist_memberships_playlist_key_fkey"
            columns: ["playlist_key"]
            isOneToOne: false
            referencedRelation: "playlists"
            referencedColumns: ["playlist_key"]
          },
          {
            foreignKeyName: "playlist_memberships_playlist_key_fkey"
            columns: ["playlist_key"]
            isOneToOne: false
            referencedRelation: "playlists_public"
            referencedColumns: ["playlist_key"]
          },
          {
            foreignKeyName: "playlist_memberships_playlist_key_fkey"
            columns: ["playlist_key"]
            isOneToOne: false
            referencedRelation: "playlists_with_latest_stats_public"
            referencedColumns: ["playlist_key"]
          },
        ]
      }
      playlists_public: {
        Row: {
          collector: string | null
          display_name: string | null
          display_order: number | null
          is_catalog: boolean | null
          playlist_key: string | null
          playlist_type: string | null
          spotify_playlist_id: string | null
          spotify_playlist_image_url: string | null
        }
        Insert: {
          collector?: string | null
          display_name?: string | null
          display_order?: number | null
          is_catalog?: boolean | null
          playlist_key?: string | null
          playlist_type?: string | null
          spotify_playlist_id?: string | null
          spotify_playlist_image_url?: string | null
        }
        Update: {
          collector?: string | null
          display_name?: string | null
          display_order?: number | null
          is_catalog?: boolean | null
          playlist_key?: string | null
          playlist_type?: string | null
          spotify_playlist_id?: string | null
          spotify_playlist_image_url?: string | null
        }
        Relationships: []
      }
      playlists_with_latest_stats_public: {
        Row: {
          collector: string | null
          daily_streams_net: number | null
          display_name: string | null
          display_order: number | null
          est_revenue_daily_net: number | null
          is_catalog: boolean | null
          missing_streams_track_count: number | null
          playlist_key: string | null
          playlist_type: string | null
          spotify_playlist_id: string | null
          spotify_playlist_image_url: string | null
          stats_date: string | null
          total_streams_cumulative: number | null
          track_count: number | null
        }
        Relationships: []
      }
      track_daily_streams_effective: {
        Row: {
          base_created_at: string | null
          date: string | null
          is_manual_override: boolean | null
          isrc: string | null
          manual_created_at: string | null
          manual_created_by: string | null
          manual_note: string | null
          override_id: number | null
          source_run_id: string | null
          streams_cumulative: number | null
        }
        Relationships: []
      }
      track_daily_streams_effective_public: {
        Row: {
          date: string | null
          isrc: string | null
          streams_cumulative: number | null
        }
        Relationships: []
      }
      tracks_public: {
        Row: {
          isrc: string | null
          last_seen: string | null
          name: string | null
          release_date: string | null
          spotify_album_image_url: string | null
          spotify_artist_ids: string[] | null
          spotify_artist_names: string[] | null
          spotify_track_id: string | null
        }
        Insert: {
          isrc?: string | null
          last_seen?: string | null
          name?: string | null
          release_date?: string | null
          spotify_album_image_url?: string | null
          spotify_artist_ids?: string[] | null
          spotify_artist_names?: string[] | null
          spotify_track_id?: string | null
        }
        Update: {
          isrc?: string | null
          last_seen?: string | null
          name?: string | null
          release_date?: string | null
          spotify_album_image_url?: string | null
          spotify_artist_ids?: string[] | null
          spotify_artist_names?: string[] | null
          spotify_track_id?: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      artist_collaboration_graph: {
        Args: {
          p_hide_non_primary?: boolean
          p_playlist_key?: string
          p_scope_playlist_mode?: string
          p_scope_playlists?: string[]
        }
        Returns: Json
      }
      artist_total_streams_for_date: {
        Args: { artist_id: string; run_date: string }
        Returns: number
      }
      can_access_playlist_watch: { Args: never; Returns: boolean }
      catalog_active_isrcs: {
        Args: { p_as_of: string }
        Returns: {
          isrc: string
        }[]
      }
      catalog_artist_series: {
        Args: { artist_id: string; end_date: string; start_date: string }
        Returns: {
          date: string
          streams_cumulative: number
        }[]
      }
      catalog_artist_series_fast: {
        Args: { artist_id: string; end_date: string; start_date: string }
        Returns: {
          date: string
          streams_cumulative: number
        }[]
      }
      catalog_artist_top_tracks_daily: {
        Args: { artist_id: string; limit_rows?: number; run_date: string }
        Returns: {
          album_image_url: string
          daily: number
          isrc: string
          name: string
          total: number
        }[]
      }
      catalog_artist_top_tracks_total: {
        Args: { artist_id: string; limit_rows?: number; run_date: string }
        Returns: {
          album_image_url: string
          daily: number
          isrc: string
          name: string
          total: number
        }[]
      }
      catalog_config_artist_rows: {
        Args: {
          result_limit_rows?: number
          result_offset_rows?: number
          track_limit_rows?: number
        }
        Returns: {
          daily_streams: number
          daily_track_count: number
          distro_playlists: Json
          external_url: string
          id: string
          image_url: string
          in_house: boolean
          name: string
          total_streams: number
          track_count: number
        }[]
      }
      catalog_config_track_rows: {
        Args: { limit_rows?: number; offset_rows?: number }
        Returns: {
          daily_streams: number
          distro_playlists: Json
          isrc: string
          last_seen: string
          name: string
          release_date: string
          spotify_album_image_url: string
          spotify_artist_ids: string[]
          spotify_artist_names: string[]
          spotify_track_id: string
          total_streams: number
        }[]
      }
      catalog_membership_churn: {
        Args: { p_as_of?: string; p_window_days?: number }
        Returns: {
          added_count: number
          net: number
          removed_count: number
        }[]
      }
      collector_artist_counts_for_date: {
        Args: { run_date: string }
        Returns: {
          artist_count: number
          collector: string
        }[]
      }
      collector_artist_counts_for_date_scoped: {
        Args: { p_use_entity_playlists?: boolean; run_date: string }
        Returns: {
          artist_count: number
          collector: string
        }[]
      }
      collector_artists_paged: {
        Args: {
          collector: string
          limit_rows?: number
          offset_rows?: number
          run_date: string
        }
        Returns: {
          artist_id: string
          image_url: string
          name: string
          track_count: number
        }[]
      }
      collector_artists_stats_paged: {
        Args: {
          collector: string
          limit_rows?: number
          offset_rows?: number
          run_date: string
        }
        Returns: {
          artist_id: string
          daily_streams_delta: number
          image_url: string
          name: string
          total_streams_cumulative: number
          track_count: number
        }[]
      }
      collector_artists_stats_paged_scoped: {
        Args: {
          collector: string
          limit_rows?: number
          offset_rows?: number
          p_use_entity_playlists?: boolean
          run_date: string
        }
        Returns: {
          artist_id: string
          daily_streams_delta: number
          image_url: string
          name: string
          total_streams_cumulative: number
          track_count: number
        }[]
      }
      collector_daily_agg_bucketed: {
        Args: {
          p_collectors: string[]
          p_granularity: string
          p_max_date?: string
        }
        Returns: {
          bucket: string
          collector: string
          first_track_count: number
          last_track_count: number
          sum_daily_streams: number
        }[]
      }
      collector_effective_playlists: {
        Args: { p_collector: string; p_use_entity_playlists?: boolean }
        Returns: {
          playlist_key: string
          playlist_type: string
        }[]
      }
      collector_overlap_artist_matrix: {
        Args: { p_as_of?: string; p_use_entity_playlists?: boolean }
        Returns: {
          collector_a: string
          collector_a_total: number
          collector_b: string
          collector_b_total: number
          jaccard: number
          shared_artists: number
        }[]
      }
      collector_overlap_artists: {
        Args: {
          p_as_of: string
          p_collector_a: string
          p_collector_b: string
          p_use_entity_playlists?: boolean
        }
        Returns: {
          artist_id: string
          artist_name: string
          image_url: string
        }[]
      }
      collector_overlap_matrix: {
        Args: { p_as_of?: string; p_use_entity_playlists?: boolean }
        Returns: {
          collector_a: string
          collector_a_total: number
          collector_b: string
          collector_b_total: number
          jaccard: number
          shared_isrcs: number
        }[]
      }
      collector_overlap_tracks: {
        Args: {
          p_as_of: string
          p_collector_a: string
          p_collector_b: string
          p_use_entity_playlists?: boolean
        }
        Returns: {
          album_image_url: string
          artist_names: string[]
          isrc: string
          name: string
        }[]
      }
      collector_tracks: {
        Args: {
          collector: string
          limit_rows?: number
          prev_date?: string
          run_date: string
        }
        Returns: {
          album_image_url: string
          artist_ids: string[]
          artist_names: string[]
          daily_streams_delta: number
          distro_playlist_keys: string[]
          isrc: string
          name: string
          playlist_keys: string[]
          total_streams_cumulative: number
        }[]
      }
      collector_tracks_paged: {
        Args: {
          collector: string
          limit_rows?: number
          offset_rows?: number
          prev_date?: string
          run_date: string
        }
        Returns: {
          album_image_url: string
          artist_ids: string[]
          artist_names: string[]
          daily_streams_delta: number
          distro_playlist_keys: string[]
          isrc: string
          name: string
          playlist_keys: string[]
          release_date: string
          total_streams_cumulative: number
        }[]
      }
      collector_tracks_paged_scoped: {
        Args: {
          collector: string
          limit_rows?: number
          offset_rows?: number
          p_use_entity_playlists?: boolean
          prev_date?: string
          run_date: string
        }
        Returns: {
          album_image_url: string
          artist_ids: string[]
          artist_names: string[]
          daily_streams_delta: number
          distro_playlist_keys: string[]
          isrc: string
          name: string
          playlist_keys: string[]
          total_streams_cumulative: number
        }[]
      }
      delete_upload_cascade: {
        Args: { upload_uuid: string }
        Returns: undefined
      }
      effective_streams_for_date: {
        Args: { p_date: string }
        Returns: {
          isrc: string
          streams_cumulative: number
        }[]
      }
      ensure_track_daily_streams_partitions: {
        Args: { months_ahead?: number }
        Returns: undefined
      }
      get_chart_week_highlight_day_for_email: {
        Args: { email_input: string }
        Returns: number
      }
      get_collector_stats_with_spotify_date: {
        Args: { end_date?: string; start_date?: string }
        Returns: {
          accounts_count: number
          collector: string
          distributors_count: number
          latest_spotify_date: string
          total_revenue: number
          total_streams: number
          unique_artists: number
          unique_tracks: number
        }[]
      }
      get_statement_coverage_matrix: {
        Args: never
        Returns: {
          account_id: string
          account_name: string
          currency: string
          distributor_name: string
          file_count: number
          file_names: string[]
          has_spotify: boolean
          month: number
          spotify_revenue: number
          spotify_usd_revenue: number
          total_revenue: number
          total_usd_revenue: number
          upload_ids: string[]
          year: number
        }[]
      }
      get_statement_coverage_matrix_year: {
        Args: { p_year: number }
        Returns: {
          account_id: string
          account_name: string
          currency: string
          distributor_name: string
          file_count: number
          file_names: string[]
          has_spotify: boolean
          month: number
          spotify_revenue: number
          spotify_usd_revenue: number
          total_revenue: number
          total_usd_revenue: number
          upload_ids: string[]
          year: number
        }[]
      }
      get_statement_coverage_years: {
        Args: never
        Returns: {
          year: number
        }[]
      }
      get_track_revenue_breakdown: {
        Args: { p_cutoff_date?: string; p_from_date?: string; p_isrc: string }
        Returns: {
          adjustment_note: string
          adjustment_policy: string
          collector: string
          distributor: string
          distributor_account: string
          effective_revenue_usd: number
          reported_gross_usd: number
          reported_net_usd: number
          spotify_quantity: number
        }[]
      }
      get_track_spotify_collector_months: {
        Args: { p_cutoff_date?: string; p_from_date?: string; p_isrc: string }
        Returns: {
          collector: string
          earliest_spotify_royalty_date: string
          latest_spotify_royalty_date: string
        }[]
      }
      health_distro_overlap_tracks: {
        Args: { run_date: string }
        Returns: {
          album_image_url: string
          artist_ids: string[]
          artist_names: string[]
          distro_playlist_keys: string[]
          isrc: string
          name: string
        }[]
      }
      health_entity_distro_drift: {
        Args: { run_date: string }
        Returns: {
          album_image_url: string
          artist_ids: string[]
          artist_names: string[]
          drift_type: string
          entity_playlist_key: string
          isrc: string
          name: string
          source_playlist_key: string
        }[]
      }
      health_missing_catalog_tracks: {
        Args: { run_date: string }
        Returns: {
          album_image_url: string
          artist_ids: string[]
          artist_names: string[]
          isrc: string
          name: string
          playlist_keys: string[]
        }[]
      }
      health_missing_catalog_tracks_detailed: {
        Args: { run_date: string }
        Returns: {
          album_image_url: string
          artist_ids: string[]
          artist_names: string[]
          exclusion_global_id: number
          exclusion_playlist_id: number
          first_seen_in_playlist: string
          is_excluded: boolean
          isrc: string
          last_seen_in_playlist: string
          name: string
          playlist_key: string
        }[]
      }
      health_negative_daily_streams: {
        Args: { run_date: string }
        Returns: {
          album_image_url: string
          artist_ids: string[]
          artist_names: string[]
          daily_streams_delta: number
          isrc: string
          name: string
          total_streams_cumulative: number
        }[]
      }
      health_playlist_missing_catalog_tracks: {
        Args: { playlist_key: string; run_date: string }
        Returns: {
          album_image_url: string
          artist_ids: string[]
          artist_names: string[]
          isrc: string
          name: string
        }[]
      }
      health_playlist_missing_enrichment_tracks: {
        Args: { limit_rows?: number; playlist_key: string; run_date: string }
        Returns: {
          album_image_url: string
          artist_ids: string[]
          artist_names: string[]
          isrc: string
          name: string
        }[]
      }
      health_track_count_swing_tracks: {
        Args: { playlist_key: string; run_date: string }
        Returns: {
          album_image_url: string
          artist_ids: string[]
          artist_names: string[]
          change_type: string
          isrc: string
          name: string
        }[]
      }
      health_unplayable_candidates: {
        Args: { limit_rows?: number; run_date: string }
        Returns: {
          album_image_url: string
          artist_ids: string[]
          artist_names: string[]
          first_catalog_date: string
          isrc: string
          last_catalog_date: string
          name: string
          playlist_keys: string[]
        }[]
      }
      home_artificial_stream_spikes: {
        Args: {
          p_end_date?: string
          p_grace_days?: number
          p_include_weekends?: boolean
          p_min_baseline?: number
          p_spike_ratio?: number
          p_start_date?: string
          p_threshold_crossing_max?: number
        }
        Returns: {
          album_image_url: string
          artist_ids: string[]
          artist_names: string[]
          avg_same_dow: number
          daily_streams: number
          date: string
          isrc: string
          name: string
          spike_ratio: number
          streams_cumulative: number
        }[]
      }
      home_artist_weekend_dips:
        | {
            Args: { p_min_weekday_avg?: number }
            Returns: {
              artist_id: string
              artist_name: string
              avg_dip_pct: number
              image_url: string
              sat_dip_pct: number
              sat_streams: number
              sun_dip_pct: number
              sun_streams: number
              track_count: number
              weekday_avg: number
            }[]
          }
        | {
            Args: { p_anchor_data_date?: string; p_min_weekday_avg?: number }
            Returns: {
              artist_id: string
              artist_name: string
              avg_dip_pct: number
              image_url: string
              sat_dip_pct: number
              sat_streams: number
              sun_dip_pct: number
              sun_streams: number
              track_count: number
              weekday_avg: number
            }[]
          }
      home_negative_daily_streams: {
        Args: never
        Returns: {
          album_image_url: string
          artist_ids: string[]
          artist_names: string[]
          daily_streams_delta: number
          date: string
          isrc: string
          name: string
          total_streams_cumulative: number
        }[]
      }
      home_track_scatter_points: {
        Args: { p_prev_date: string; p_run_date: string }
        Returns: {
          album_image_url: string
          artist_ids: string[]
          artist_names: string[]
          daily_streams_delta: number
          has_prev_day: boolean
          isrc: string
          name: string
          release_date: string
          total_streams_cumulative: number
        }[]
      }
      home_track_weekend_dips:
        | {
            Args: { p_min_weekday_avg?: number }
            Returns: {
              album_image_url: string
              artist_name: string
              avg_dip_pct: number
              isrc: string
              name: string
              sat_dip_pct: number
              sat_streams: number
              sun_dip_pct: number
              sun_streams: number
              weekday_avg: number
            }[]
          }
        | {
            Args: { p_anchor_data_date?: string; p_min_weekday_avg?: number }
            Returns: {
              album_image_url: string
              artist_name: string
              avg_dip_pct: number
              isrc: string
              name: string
              sat_dip_pct: number
              sat_streams: number
              sun_dip_pct: number
              sun_streams: number
              weekday_avg: number
            }[]
          }
      is_admin: { Args: never; Returns: boolean }
      is_playlist_watch_admin: { Args: never; Returns: boolean }
      network_export_artist_stream_stats: {
        Args: {
          p_artist_ids: string[]
          p_hide_non_primary?: boolean
          p_playlist_key?: string
        }
        Returns: {
          artist_id: string
          daily_streams_all_catalog: number
          daily_streams_in_scope: number
          total_streams_all_catalog: number
          total_streams_in_scope: number
          tracks_all_catalog: number
          tracks_in_scope: number
        }[]
      }
      network_selection_scoped_isrcs: {
        Args: {
          p_artist_ids: string[]
          p_hide_non_primary?: boolean
          p_limit?: number
          p_offset?: number
          p_playlist_key?: string
        }
        Returns: {
          isrc: string
        }[]
      }
      network_selection_scoped_track_totals: {
        Args: {
          p_artist_ids: string[]
          p_hide_non_primary?: boolean
          p_playlist_key?: string
        }
        Returns: {
          daily_streams: number
          total_streams: number
          track_count: number
        }[]
      }
      playlist_added_tracks: {
        Args: {
          days?: number
          limit_rows?: number
          playlist_key: string
          run_date: string
        }
        Returns: {
          album_image_url: string
          artist_ids: string[]
          artist_names: string[]
          isrc: string
          name: string
          valid_from: string
        }[]
      }
      playlist_daily_stats_as_of: {
        Args: { p_as_of_date: string }
        Returns: {
          daily_streams_net: number
          date: string
          missing_streams_track_count: number
          playlist_key: string
          total_streams_cumulative: number
          track_count: number
        }[]
      }
      playlist_dashboard_summary: {
        Args: { as_of_date?: string; playlist_key: string }
        Returns: {
          daily_streams_net: number
          distinct_artist_count: number
          est_revenue_daily_net: number
          est_revenue_total: number
          latest_date: string
          prev_date: string
          removed_tracks_count: number
          total_streams_cumulative: number
          track_count: number
        }[]
      }
      playlist_distinct_artist_count: {
        Args: { playlist_key: string; run_date: string }
        Returns: number
      }
      playlist_removed_tracks: {
        Args: { limit_rows?: number; playlist_key: string }
        Returns: {
          album_image_url: string
          artist_ids: string[]
          artist_names: string[]
          isrc: string
          name: string
          valid_from: string
          valid_to: string
        }[]
      }
      playlist_series: {
        Args: { end_date: string; playlist_key: string; start_date: string }
        Returns: {
          daily_streams_net: number
          date: string
          total_streams_cumulative: number
          track_count: number
        }[]
      }
      playlist_top_tracks: {
        Args: {
          limit_rows?: number
          playlist_key: string
          prev_date?: string
          run_date: string
        }
        Returns: {
          album_image_url: string
          artist_ids: string[]
          artist_names: string[]
          daily: number
          isrc: string
          name: string
          total: number
          valid_from: string
        }[]
      }
      playlist_top_tracks_total: {
        Args: { limit_rows?: number; playlist_key: string; run_date: string }
        Returns: {
          album_image_url: string
          isrc: string
          name: string
          total: number
        }[]
      }
      playlist_total_streams_for_date: {
        Args: { playlist_key: string; run_date: string }
        Returns: number
      }
      playlists_latest_track_counts: {
        Args: { p_keys: string[]; p_max_date?: string }
        Returns: {
          playlist_key: string
          track_count: number
        }[]
      }
      refresh_analytics_views: { Args: never; Returns: Json }
      refresh_artist_daily_stats: {
        Args: { p_end_date?: string; p_start_date?: string }
        Returns: number
      }
      refresh_health_warning_history_mv: { Args: never; Returns: undefined }
      sai_docs_search: {
        Args: { match_count?: number; query_embedding: number[] }
        Returns: {
          chunk_id: string
          content_text: string
          score: number
          sources: string[]
          title: string
        }[]
      }
      search_all: {
        Args: { max_results?: number; q: string }
        Returns: {
          artist_ids: string[]
          artist_names: string[]
          first_artist_id: string
          id: string
          image_url: string
          name: string
          subtitle: string
          track_count: number
          type: string
        }[]
      }
      search_artists: {
        Args: { max_results?: number; q: string }
        Returns: {
          spotify_artist_id: string
          spotify_artist_name: string
          track_count: number
        }[]
      }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
      spotibase_docs_inventory: { Args: never; Returns: Json }
      spotibase_recompute_playlist_daily_stats: {
        Args: { p_date: string }
        Returns: undefined
      }
      spotibase_recompute_playlist_daily_stats_cascade: {
        Args: { p_end_date?: string; p_start_date: string }
        Returns: number
      }
      spotibase_remove_stream_override: {
        Args: { p_override_id: number }
        Returns: number
      }
      spotibase_system_stats: { Args: never; Returns: Json }
      track_series: {
        Args: { end_date: string; isrc: string; start_date: string }
        Returns: {
          date: string
          streams_cumulative: number
        }[]
      }
      track_total_streams_for_date: {
        Args: { isrc: string; run_date: string }
        Returns: number
      }
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
    Enums: {},
  },
} as const
