<?php
header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(200); exit; }

$payload = json_decode(file_get_contents('php://input'), true);
$old = isset($payload['oldName']) ? $payload['oldName'] : null;
$new = isset($payload['newName']) ? $payload['newName'] : null;
if (!$old || !$new) { echo json_encode(['ok'=>false, 'error'=>'oldName and newName required']); exit; }

function sanitize_name($name){
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
		$name = preg_replace('/[^A-Za-z0-9._\- ]+/', '-', $name);
		$name = preg_replace('/\s+/', ' ', $name);
		return trim($name);
	}
}

$dir = __DIR__ . DIRECTORY_SEPARATOR . 'uploads';
// Convert forward slashes to system separators for proper path handling
$old = str_replace('/', DIRECTORY_SEPARATOR, $old);
$oldPath = $dir . DIRECTORY_SEPARATOR . $old;
$newName = sanitize_name($new);
$newPath = $dir . DIRECTORY_SEPARATOR . str_replace('/', DIRECTORY_SEPARATOR, $newName);

// Security check - ensure old path is within uploads directory
$realDir = realpath($dir);
$realOldPath = realpath($oldPath);
if (!$realOldPath || strpos($realOldPath, $realDir) !== 0) { 
	echo json_encode(['ok'=>false, 'error'=>'invalid old path']); 
	exit; 
}

if (!is_file($realOldPath)) { 
	echo json_encode(['ok'=>false, 'error'=>'old file missing']); 
	exit; 
}

// Create directory for new path if needed
$newDir = dirname($newPath);
if (!is_dir($newDir)) {
	if (!@mkdir($newDir, 0775, true)) {
		echo json_encode(['ok'=>false, 'error'=>'cannot create directory']); 
		exit; 
	}
}

if (file_exists($newPath)) { 
	echo json_encode(['ok'=>false, 'error'=>'target exists']); 
	exit; 
}

if (!@rename($realOldPath, $newPath)) { 
	echo json_encode(['ok'=>false, 'error'=>'rename failed']); 
	exit; 
}

echo json_encode(['ok'=>true, 'name'=>$newName]);
