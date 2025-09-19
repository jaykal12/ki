<?php
header('Content-Type: application/json');
// InfinityFree often blocks CORS only cross-origin; same-origin ok. Add permissive headers just in case.
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(200); exit; }

// Enable error reporting for debugging
error_reporting(E_ALL);
ini_set('display_errors', 1);

$uploadDir = __DIR__ . DIRECTORY_SEPARATOR . 'uploads';
if (!is_dir($uploadDir)) {
	@mkdir($uploadDir, 0775, true);
}

function sanitize_name($name) {
	// For folder uploads, preserve directory structure but sanitize each part
	if (strpos($name, '/') !== false || strpos($name, '\\') !== false) {
		// Split by both forward and backward slashes
		$parts = preg_split('/[\/\\\\]+/', $name);
		$sanitized_parts = [];
		foreach ($parts as $part) {
			if (trim($part) !== '') {
				// Sanitize each directory/file name part
				$sanitized_part = preg_replace('/[^A-Za-z0-9._\- ]+/', '-', $part);
				$sanitized_part = preg_replace('/\s+/', ' ', $sanitized_part);
				$sanitized_parts[] = trim($sanitized_part);
			}
		}
		return implode('/', $sanitized_parts);
	} else {
		// Single file - remove path info and illegal chars
		$name = basename($name);
		// replace spaces and weird chars
		$name = preg_replace('/[^A-Za-z0-9._\- ]+/', '-', $name);
		$name = preg_replace('/\s+/', ' ', $name);
		return trim($name);
	}
}

$response = [ 'uploaded' => [], 'errors' => [] ];

if (!isset($_FILES['files'])) {
	echo json_encode([ 'uploaded' => [], 'errors' => ['No files provided'] ]);
	exit;
}

$files = $_FILES['files'];
$filePaths = isset($_POST['file_paths']) ? $_POST['file_paths'] : [];
$count = is_array($files['name']) ? count($files['name']) : 0;

// Debug logging
error_log("Upload request received. Files count: $count");
error_log("File paths: " . print_r($filePaths, true));
error_log("Files array: " . print_r(array_keys($_FILES), true));

for ($i = 0; $i < $count; $i++) {
	// Use custom file path if provided, otherwise use original filename
	$originalName = isset($filePaths[$i]) ? $filePaths[$i] : $files['name'][$i];
	$name = sanitize_name($originalName);
	$tmp = $files['tmp_name'][$i];
	$err = $files['error'][$i];
	
	error_log("Processing file $i: original='$originalName', sanitized='$name', tmp='$tmp', error=$err");
	
	if ($err !== UPLOAD_ERR_OK) { 
		$response['errors'][] = "$name: upload error $err"; 
		continue; 
	}
	
	// Handle directory structure - convert forward slashes to system separators
	$name = str_replace('/', DIRECTORY_SEPARATOR, $name);
	$dest = $uploadDir . DIRECTORY_SEPARATOR . $name;
	$destDir = dirname($dest);
	
	// Create directory if it doesn't exist
	if (!is_dir($destDir)) {
		if (!@mkdir($destDir, 0775, true)) {
			$response['errors'][] = "$name: cannot create directory $destDir";
			continue;
		}
	}
	
	// If file exists, append numeric suffix
	$base = pathinfo($name, PATHINFO_FILENAME);
	$ext = pathinfo($name, PATHINFO_EXTENSION);
	$dir = dirname($name);
	$originalDest = $dest;
	$k = 1;
	while (file_exists($dest)) {
		$try = $base . " ($k)" . ($ext ? ".$ext" : '');
		$tryName = ($dir !== '.' && $dir !== '') ? $dir . DIRECTORY_SEPARATOR . $try : $try;
		$dest = $uploadDir . DIRECTORY_SEPARATOR . $tryName;
		$k++;
	}
	
	if (!move_uploaded_file($tmp, $dest)) {
		$response['errors'][] = "$name: cannot move file to $dest";
		continue;
	}
	chmod($dest, 0664);
	
	// Return the path with forward slashes for web compatibility
	$webPath = str_replace(DIRECTORY_SEPARATOR, '/', $name);
	$response['uploaded'][] = $webPath;
}

echo json_encode($response);
