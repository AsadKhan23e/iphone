import 'dart:async';
import 'dart:io';

import 'package:camera/camera.dart';
import 'package:flutter/material.dart';
import 'package:path_provider/path_provider.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:wakelock_plus/wakelock_plus.dart';
import 'package:gallery_saver_plus/gallery_saver.dart';
import 'package:permission_handler/permission_handler.dart';
import 'package:path/path.dart' as p;
import 'package:intl/intl.dart';

void main() async {
  WidgetsFlutterBinding.ensureInitialized();
  runApp(const StealthApp());
}

class StealthApp extends StatelessWidget {
  const StealthApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Stealth Recorder Pro',
      debugShowCheckedModeBanner: false,
      theme: ThemeData.dark().copyWith(
        primaryColor: Colors.red,
        scaffoldBackgroundColor: Colors.black,
      ),
      home: const PinAuthWrapper(),
    );
  }
}

// Wrapper to decide whether to show PIN screen or Home
class PinAuthWrapper extends StatefulWidget {
  const PinAuthWrapper({super.key});

  @override
  State<PinAuthWrapper> createState() => _PinAuthWrapperState();
}

class _PinAuthWrapperState extends State<PinAuthWrapper> {
  bool _isLocked = true;
  String? _savedPin;

  @override
  void initState() {
    super.initState();
    _loadPin();
  }

  Future<void> _loadPin() async {
    final prefs = await SharedPreferences.getInstance();
    setState(() {
      _savedPin = prefs.getString('app_pin');
      if (_savedPin == null) {
        _isLocked = false; // Initial setup
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    if (_isLocked && _savedPin != null) {
      return PinScreen(
        onSuccess: () => setState(() => _isLocked = false),
        savedPin: _savedPin!,
      );
    }
    return const StealthHomeScreen();
  }
}

class PinScreen extends StatefulWidget {
  final VoidCallback onSuccess;
  final String savedPin;

  const PinScreen({super.key, required this.onSuccess, required this.savedPin});

  @override
  State<PinScreen> createState() => _PinScreenState();
}

class _PinScreenState extends State<PinScreen> {
  final TextEditingController _controller = TextEditingController();

  void _verify() {
    if (_controller.text == widget.savedPin) {
      widget.onSuccess();
    } else {
      _controller.clear();
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(const SnackBar(content: Text('Wrong PIN!')));
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Center(
        child: Padding(
          padding: const EdgeInsets.all(40.0),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              const Icon(Icons.lock, size: 80, color: Colors.red),
              const SizedBox(height: 20),
              const Text('Enter App PIN', style: TextStyle(fontSize: 20)),
              const SizedBox(height: 20),
              TextField(
                controller: _controller,
                obscureText: true,
                keyboardType: TextInputType.number,
                textAlign: TextAlign.center,
                decoration: const InputDecoration(border: OutlineInputBorder()),
              ),
              const SizedBox(height: 20),
              ElevatedButton(
                onPressed: _verify,
                style: ElevatedButton.styleFrom(backgroundColor: Colors.red),
                child: const Text('UNLOCK'),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class StealthHomeScreen extends StatefulWidget {
  const StealthHomeScreen({super.key});

  @override
  State<StealthHomeScreen> createState() => _StealthHomeScreenState();
}

class _StealthHomeScreenState extends State<StealthHomeScreen> {
  CameraController? _controller;
  List<CameraDescription>? _cameras;
  bool _isInit = false;
  bool _isRecording = false;
  bool _isStealthMode = false;

  @override
  void initState() {
    super.initState();
    _initApp();
  }

  Future<void> _initApp() async {
    Map<Permission, PermissionStatus> statuses = await [
      Permission.camera,
      Permission.microphone,
      Permission.storage,
      Permission.photos,
    ].request();

    if (statuses[Permission.camera]!.isGranted &&
        statuses[Permission.microphone]!.isGranted) {
      _cameras = await availableCameras();
      if (_cameras != null && _cameras!.isNotEmpty) {
        _controller = CameraController(
          _cameras![0],
          ResolutionPreset.high,
          enableAudio: true,
        );

        try {
          await _controller!.initialize();
          if (mounted) setState(() => _isInit = true);
        } catch (e) {
          debugPrint("Camera Error: $e");
        }
      }
    }
  }

  @override
  void dispose() {
    _controller?.dispose();
    WakelockPlus.disable();
    super.dispose();
  }

  Future<void> _startRecording() async {
    if (_controller == null || !_controller!.value.isInitialized) return;
    try {
      await _controller!.startVideoRecording();
      await WakelockPlus.enable();
      setState(() => _isRecording = true);
    } catch (e) {
      debugPrint("Error: $e");
    }
  }

  Future<void> _stopRecording() async {
    if (_controller == null || !_controller!.value.isRecordingVideo) return;
    try {
      XFile videoFile = await _controller!.stopVideoRecording();
      await WakelockPlus.disable();

      // Move file to Private Documents folder
      final directory = await getApplicationDocumentsDirectory();
      final String timestamp = DateFormat(
        'yyyyMMdd_HHmmss',
      ).format(DateTime.now());
      final String fileName = 'RECORDING_$timestamp.mp4';
      final File savedFile = File(p.join(directory.path, fileName));

      await File(videoFile.path).copy(savedFile.path);
      // Delete temporary file
      await File(videoFile.path).delete();

      setState(() {
        _isRecording = false;
        _isStealthMode = false;
      });

      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Recording saved privately.')),
        );
      }
    } catch (e) {
      debugPrint("Stop Error: $e");
    }
  }

  @override
  Widget build(BuildContext context) {
    if (!_isInit)
      return const Scaffold(body: Center(child: CircularProgressIndicator()));

    return Scaffold(
      body: GestureDetector(
        behavior: HitTestBehavior.opaque,
        onDoubleTap: () => setState(() => _isStealthMode = false),
        child: Stack(
          children: [
            if (_controller != null && _controller!.value.isInitialized)
              Center(child: CameraPreview(_controller!)),
            if (_isStealthMode) Container(color: Colors.black),
            if (!_isStealthMode)
              SafeArea(
                child: Column(
                  children: [
                    // Header with Menu
                    Padding(
                      padding: const EdgeInsets.all(16.0),
                      child: Row(
                        mainAxisAlignment: MainAxisAlignment.spaceBetween,
                        children: [
                          IconButton(
                            icon: const Icon(Icons.video_library, size: 30),
                            onPressed: () {
                              Navigator.push(
                                context,
                                MaterialPageRoute(
                                  builder: (_) => const RecordingsScreen(),
                                ),
                              );
                            },
                          ),
                          IconButton(
                            icon: const Icon(Icons.settings, size: 30),
                            onPressed: _showSettings,
                          ),
                        ],
                      ),
                    ),
                    const Spacer(),
                    // Bottom Controls
                    Container(
                      padding: const EdgeInsets.symmetric(vertical: 30),
                      color: Colors.black54,
                      child: Row(
                        mainAxisAlignment: MainAxisAlignment.spaceEvenly,
                        children: [
                          GestureDetector(
                            onTap: _isRecording
                                ? _stopRecording
                                : _startRecording,
                            child: Container(
                              padding: const EdgeInsets.all(4),
                              decoration: BoxDecoration(
                                shape: BoxShape.circle,
                                border: Border.all(
                                  color: Colors.white,
                                  width: 3,
                                ),
                              ),
                              child: Icon(
                                _isRecording ? Icons.stop : Icons.circle,
                                size: 70,
                                color: Colors.red,
                              ),
                            ),
                          ),
                          if (_isRecording)
                            IconButton(
                              iconSize: 50,
                              icon: const Icon(
                                Icons.visibility_off,
                                color: Colors.white,
                              ),
                              onPressed: () =>
                                  setState(() => _isStealthMode = true),
                            ),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
          ],
        ),
      ),
    );
  }

  void _showSettings() async {
    final prefs = await SharedPreferences.getInstance();
    final TextEditingController pinCtrl = TextEditingController();

    if (mounted) {
      showDialog(
        context: context,
        builder: (context) => AlertDialog(
          title: const Text('Set App PIN'),
          content: TextField(
            controller: pinCtrl,
            decoration: const InputDecoration(hintText: 'Enter 4-6 digits'),
            keyboardType: TextInputType.number,
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(context),
              child: const Text('Cancel'),
            ),
            TextButton(
              onPressed: () async {
                await prefs.setString('app_pin', pinCtrl.text);
                if (mounted) Navigator.pop(context);
              },
              child: const Text('Save'),
            ),
          ],
        ),
      );
    }
  }
}

class RecordingsScreen extends StatefulWidget {
  const RecordingsScreen({super.key});

  @override
  State<RecordingsScreen> createState() => _RecordingsScreenState();
}

class _RecordingsScreenState extends State<RecordingsScreen> {
  List<File> _files = [];

  @override
  void initState() {
    super.initState();
    _loadFiles();
  }

  Future<void> _loadFiles() async {
    final directory = await getApplicationDocumentsDirectory();
    final List<FileSystemEntity> entities = directory.listSync();
    setState(() {
      _files = entities
          .whereType<File>()
          .where((f) => f.path.endsWith('.mp4'))
          .toList();
      _files.sort(
        (a, b) => b.lastModifiedSync().compareTo(a.lastModifiedSync()),
      );
    });
  }

  Future<void> _exportToGallery(File file) async {
    await GallerySaver.saveVideo(file.path);
    if (mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Video exported to Gallery!')),
      );
    }
  }

  Future<void> _delete(File file) async {
    await file.delete();
    _loadFiles();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Private Recordings'),
        backgroundColor: Colors.black,
      ),
      body: _files.isEmpty
          ? const Center(child: Text('No recordings found.'))
          : ListView.builder(
              itemCount: _files.length,
              itemBuilder: (context, index) {
                final file = _files[index];
                return ListTile(
                  leading: const Icon(Icons.movie, color: Colors.blue),
                  title: Text(p.basename(file.path)),
                  subtitle: Text(
                    'Size: ${(file.lengthSync() / (1024 * 1024)).toStringAsFixed(2)} MB',
                  ),
                  trailing: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      IconButton(
                        icon: const Icon(Icons.download, color: Colors.green),
                        onPressed: () => _exportToGallery(file),
                      ),
                      IconButton(
                        icon: const Icon(Icons.delete, color: Colors.red),
                        onPressed: () => _delete(file),
                      ),
                    ],
                  ),
                );
              },
            ),
    );
  }
}
