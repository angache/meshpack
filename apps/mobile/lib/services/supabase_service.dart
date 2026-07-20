import "package:supabase_flutter/supabase_flutter.dart";

class SupabaseService {
  SupabaseService._();

  static Future<void> init({
    required String url,
    required String anonKey,
  }) async {
    await Supabase.initialize(
      url: url,
      publishableKey: anonKey,
    );
  }

  static SupabaseClient get client => Supabase.instance.client;

  static Future<AuthResponse> signIn({
    required String email,
    required String password,
  }) {
    return client.auth.signInWithPassword(email: email, password: password);
  }

  static Future<AuthResponse> signUp({
    required String email,
    required String password,
    Map<String, dynamic>? metadata,
  }) {
    return client.auth.signUp(
      email: email,
      password: password,
      data: metadata,
    );
  }

  static Future<void> signOut() => client.auth.signOut();
}
