import "dart:convert";
import "dart:typed_data";

import "package:cryptography/cryptography.dart";
import "package:flutter/material.dart";
import "package:flutter_dotenv/flutter_dotenv.dart";
import "package:supabase_flutter/supabase_flutter.dart";

import "services/case_receiver.dart";
import "services/case_sender.dart";
import "services/key_service.dart";
import "services/supabase_service.dart";

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await dotenv.load(fileName: ".env");

  final url = dotenv.env["SUPABASE_URL"];
  final anonKey = dotenv.env["SUPABASE_ANON_KEY"];
  if (url == null || anonKey == null || url.isEmpty || anonKey.isEmpty) {
    throw StateError("SUPABASE_URL / SUPABASE_ANON_KEY .env içinde tanımlı olmalı.");
  }

  await SupabaseService.init(url: url, anonKey: anonKey);
  runApp(const MeshPackApp());
}

class MeshPackApp extends StatelessWidget {
  const MeshPackApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: "MeshPack Mobile",
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        colorScheme: ColorScheme.fromSeed(
          seedColor: const Color(0xFF1B4D3E),
          brightness: Brightness.light,
        ),
        useMaterial3: true,
      ),
      home: const AuthGate(),
    );
  }
}

class AuthGate extends StatelessWidget {
  const AuthGate({super.key});

  @override
  Widget build(BuildContext context) {
    return StreamBuilder<AuthState>(
      stream: SupabaseService.client.auth.onAuthStateChange,
      builder: (context, snapshot) {
        final session = SupabaseService.client.auth.currentSession;
        if (session == null) return const AuthPage();
        return const HomePage();
      },
    );
  }
}

class AuthPage extends StatefulWidget {
  const AuthPage({super.key});

  @override
  State<AuthPage> createState() => _AuthPageState();
}

class _AuthPageState extends State<AuthPage> {
  final _email = TextEditingController();
  final _password = TextEditingController();
  bool _isSignUp = false;
  bool _busy = false;
  String? _error;

  Future<void> _submit() async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      if (_isSignUp) {
        await SupabaseService.signUp(
          email: _email.text.trim(),
          password: _password.text,
        );
      } else {
        await SupabaseService.signIn(
          email: _email.text.trim(),
          password: _password.text,
        );
      }
    } catch (e) {
      setState(() => _error = e.toString());
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  void dispose() {
    _email.dispose();
    _password.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: SafeArea(
        child: Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 420),
            child: Padding(
              padding: const EdgeInsets.all(24),
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Text(
                    "MeshPack",
                    textAlign: TextAlign.center,
                    style: Theme.of(context).textTheme.headlineMedium?.copyWith(
                          fontWeight: FontWeight.w700,
                        ),
                  ),
                  const SizedBox(height: 8),
                  Text(
                    "E2EE vaka transferi",
                    textAlign: TextAlign.center,
                    style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                          color: Theme.of(context).colorScheme.onSurfaceVariant,
                        ),
                  ),
                  const SizedBox(height: 32),
                  TextField(
                    controller: _email,
                    keyboardType: TextInputType.emailAddress,
                    autofillHints: const [AutofillHints.email],
                    decoration: const InputDecoration(
                      labelText: "E-posta",
                      border: OutlineInputBorder(),
                    ),
                  ),
                  const SizedBox(height: 12),
                  TextField(
                    controller: _password,
                    obscureText: true,
                    autofillHints: const [AutofillHints.password],
                    decoration: const InputDecoration(
                      labelText: "Şifre",
                      border: OutlineInputBorder(),
                    ),
                  ),
                  if (_error != null) ...[
                    const SizedBox(height: 12),
                    Text(
                      _error!,
                      style: TextStyle(color: Theme.of(context).colorScheme.error),
                    ),
                  ],
                  const SizedBox(height: 20),
                  FilledButton(
                    onPressed: _busy ? null : _submit,
                    child: _busy
                        ? const SizedBox(
                            height: 20,
                            width: 20,
                            child: CircularProgressIndicator(strokeWidth: 2),
                          )
                        : Text(_isSignUp ? "Kayıt ol" : "Giriş yap"),
                  ),
                  TextButton(
                    onPressed: _busy
                        ? null
                        : () => setState(() => _isSignUp = !_isSignUp),
                    child: Text(
                      _isSignUp
                          ? "Hesabın var mı? Giriş yap"
                          : "Hesap yok mu? Kayıt ol",
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class HomePage extends StatefulWidget {
  const HomePage({super.key});

  @override
  State<HomePage> createState() => _HomePageState();
}

class _HomePageState extends State<HomePage> {
  final _keys = KeyService();
  final _sender = CaseSender();
  final _receiver = CaseReceiver();
  final _passphrase = TextEditingController();
  final _receiverId = TextEditingController();
  final _patientName = TextEditingController(text: "Demo Hasta");
  final _log = StringBuffer();

  bool _hasKey = false;
  bool _busy = false;
  RealtimeChannel? _channel;

  @override
  void initState() {
    super.initState();
    _bootstrap();
  }

  Future<void> _bootstrap() async {
    final has = await _keys.hasLocalKey();
    final pair = await _keys.loadLocalKeyPair();
    setState(() {
      _hasKey = has;
    });
    if (has && pair != null) {
      _startListening(pair);
    }
  }

  void _append(String line) {
    setState(() {
      _log.writeln(line);
    });
  }

  void _startListening(SimpleKeyPairData pair) {
    _channel?.unsubscribe();
    _channel = _receiver.subscribeIncoming(
      onCase: (incoming) async {
        _append("Yeni vaka: ${incoming.id}");
        try {
          final decrypted = await _receiver.fetchAndDecryptCase(
            encryptedCase: incoming,
            receiverPrivateKey: pair,
          );
          _append(
            "Çözüldü → ${decrypted.metadata} · ${decrypted.fileBytes.length} byte",
          );
        } catch (e) {
          _append("Decrypt hata: $e");
        }
      },
    );
    _append("Realtime dinleniyor…");
  }

  Future<void> _registerKey() async {
    if (_passphrase.text.length < 8) {
      _append("Güvenlik parolası en az 8 karakter olmalı.");
      return;
    }
    setState(() => _busy = true);
    try {
      await _keys.registerIdentity(securityPassphrase: _passphrase.text);
      final pair = await _keys.loadLocalKeyPair();
      setState(() {
        _hasKey = true;
      });
      if (pair != null) _startListening(pair);
      _append("Kimlik anahtarı üretildi ve Supabase'e yedeklendi.");
    } catch (e) {
      _append("Anahtar kayıt hatası: $e");
    } finally {
      setState(() => _busy = false);
    }
  }

  Future<void> _restoreKey() async {
    if (_passphrase.text.length < 8) {
      _append("Güvenlik parolası en az 8 karakter olmalı.");
      return;
    }
    setState(() => _busy = true);
    try {
      await _keys.restoreIdentity(securityPassphrase: _passphrase.text);
      final pair = await _keys.loadLocalKeyPair();
      setState(() {
        _hasKey = true;
      });
      if (pair != null) _startListening(pair);
      _append("Anahtar yedekten geri yüklendi.");
    } catch (e) {
      _append("Geri yükleme hatası: $e");
    } finally {
      setState(() => _busy = false);
    }
  }

  Future<void> _sendDemo() async {
    final receiverId = _receiverId.text.trim();
    if (receiverId.isEmpty) {
      _append("Alıcı user UUID gerekli.");
      return;
    }
    setState(() => _busy = true);
    try {
      final sample = Uint8List.fromList(
        utf8.encode("MeshPack E2EE demo payload ${DateTime.now().toIso8601String()}"),
      );
      final caseId = await _sender.sendEncryptedCase(
        receiverId: receiverId,
        patientMetadata: {
          "patientName": _patientName.text.trim(),
          "originalFilename": "demo.txt",
          "notes": "roundtrip test",
        },
        clearFileBytes: sample,
        originalFilename: "demo.txt",
      );
      _append("Gönderildi → caseId=$caseId");
    } catch (e) {
      _append("Gönderim hatası: $e");
    } finally {
      setState(() => _busy = false);
    }
  }

  @override
  void dispose() {
    _channel?.unsubscribe();
    _passphrase.dispose();
    _receiverId.dispose();
    _patientName.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final uid = SupabaseService.client.auth.currentUser?.id ?? "—";

    return Scaffold(
      appBar: AppBar(
        title: const Text("MeshPack E2EE"),
        actions: [
          IconButton(
            tooltip: "Çıkış",
            onPressed: () => SupabaseService.signOut(),
            icon: const Icon(Icons.logout),
          ),
        ],
      ),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Card(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text("Oturum", style: Theme.of(context).textTheme.titleMedium),
                  const SizedBox(height: 8),
                  SelectableText("User ID: $uid"),
                  Text(_hasKey ? "Anahtar: cihazda hazır" : "Anahtar: yok"),
                ],
              ),
            ),
          ),
          const SizedBox(height: 12),
          if (!_hasKey) ...[
            TextField(
              controller: _passphrase,
              obscureText: true,
              decoration: const InputDecoration(
                labelText: "Güvenlik parolası (key backup)",
                border: OutlineInputBorder(),
                helperText: "Cihaz değişiminde private key için",
              ),
            ),
            const SizedBox(height: 8),
            Row(
              children: [
                Expanded(
                  child: FilledButton(
                    onPressed: _busy ? null : _registerKey,
                    child: const Text("Anahtar üret"),
                  ),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: OutlinedButton(
                    onPressed: _busy ? null : _restoreKey,
                    child: const Text("Yedekten yükle"),
                  ),
                ),
              ],
            ),
          ] else ...[
            TextField(
              controller: _receiverId,
              decoration: const InputDecoration(
                labelText: "Alıcı user UUID",
                border: OutlineInputBorder(),
                helperText: "Diğer hesabın auth.users id'si",
              ),
            ),
            const SizedBox(height: 8),
            TextField(
              controller: _patientName,
              decoration: const InputDecoration(
                labelText: "Hasta adı (şifreli metadata)",
                border: OutlineInputBorder(),
              ),
            ),
            const SizedBox(height: 8),
            FilledButton.icon(
              onPressed: _busy ? null : _sendDemo,
              icon: const Icon(Icons.lock),
              label: const Text("Şifreli demo vaka gönder"),
            ),
          ],
          const SizedBox(height: 16),
          Text("Log", style: Theme.of(context).textTheme.titleMedium),
          const SizedBox(height: 8),
          Container(
            width: double.infinity,
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              color: Theme.of(context).colorScheme.surfaceContainerHighest,
              borderRadius: BorderRadius.circular(8),
            ),
            child: SelectableText(
              _log.isEmpty ? "—" : _log.toString(),
              style: const TextStyle(fontFamily: "monospace", fontSize: 12),
            ),
          ),
        ],
      ),
    );
  }
}
