<?php
header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(200); exit; }

$payload = json_decode(file_get_contents('php://input'), true);
$name = isset($payload['name']) ? $payload['name'] : null;
if (!$name) { echo json_encode(['ok'=>false, 'error'=>'name required']); exit; }

$dir = __DIR__ . DIRECTORY_SEPARATOR . 'uploads';
// Convert forward slashes to system separators for proper path handling
$name = str_replace('/', DIRECTORY_SEPARATOR, $name);
$path = $dir . DIRECTORY_SEPARATOR . $name;

// Security check - ensure path is within uploads directory
$realDir = realpath($dir);
$realPath = realpath($path);
if (!$realPath || strpos($realPath, $realDir) !== 0) { 
	echo json_encode(['ok'=>false, 'error'=>'invalid path']); 
	exit; 
}

if (!is_file($realPath)) { 
	echo json_encode(['ok'=>false, 'error'=>'not found']); 
	exit; 
}

if (!@unlink($realPath)) { 
	echo json_encode(['ok'=>false, 'error'=>'delete failed']); 
	exit; 
}

echo json_encode(['ok'=>true]);
