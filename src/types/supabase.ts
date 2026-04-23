export interface Database {
  public: {
    Tables: {
      games: {
        Row: {
          id: string;
          created_at: string;
          started_at: string;
          ended_at: string | null;
          game_date: string | null;
          player1_name: string;
          player1_army: string;
          player1_max_points: number;
          player2_name: string;
          player2_army: string;
          player2_max_points: number;
          defender_player: 1 | 2 | null;
          starting_player: 1 | 2 | null;
          winner_player: 1 | 2 | null;
          notes: string | null;
        };
        Insert: {
          id?: string;
          created_at?: string;
          started_at?: string;
          ended_at?: string | null;
          game_date?: string | null;
          player1_name: string;
          player1_army: string;
          player1_max_points: number;
          player2_name: string;
          player2_army: string;
          player2_max_points: number;
          defender_player?: 1 | 2 | null;
          starting_player?: 1 | 2 | null;
          winner_player?: 1 | 2 | null;
          notes?: string | null;
        };
        Update: {
          id?: string;
          created_at?: string;
          started_at?: string;
          ended_at?: string | null;
          game_date?: string | null;
          player1_name?: string;
          player1_army?: string;
          player1_max_points?: number;
          player2_name?: string;
          player2_army?: string;
          player2_max_points?: number;
          defender_player?: 1 | 2 | null;
          starting_player?: 1 | 2 | null;
          winner_player?: 1 | 2 | null;
          notes?: string | null;
        };
      };
      events: {
        Row: {
          id: string;
          created_at: string;
          game_id: string;
          round_number: number | null;
          turn_number: number | null;
          player_slot: 1 | 2;
          event_type: string;
          value_number: number | null;
          note: string | null;
          occurred_at: string;
        };
        Insert: {
          id?: string;
          created_at?: string;
          game_id: string;
          round_number?: number | null;
          turn_number?: number | null;
          player_slot: 1 | 2;
          event_type: string;
          value_number?: number | null;
          note?: string | null;
          occurred_at?: string;
        };
        Update: {
          id?: string;
          created_at?: string;
          game_id?: string;
          round_number?: number | null;
          turn_number?: number | null;
          player_slot?: 1 | 2;
          event_type?: string;
          value_number?: number | null;
          note?: string | null;
          occurred_at?: string;
        };
      };
    };
  };
}
