"""
Quick Database Schema Fix
Fixes the AUTO_INCREMENT issue on all three nodes
"""
import mysql.connector
import os
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

# Database configurations
nodes = {
    'Central (Node 0)': {
        'host': os.getenv('NODE0_HOST'),
        'port': int(os.getenv('NODE0_PORT', 3306)),
        'user': os.getenv('NODE0_USER'),
        'password': os.getenv('NODE0_PASSWORD'),
        'database': os.getenv('NODE0_DB')
    },
    'Partition 1 (Node 1)': {
        'host': os.getenv('NODE1_HOST'),
        'port': int(os.getenv('NODE1_PORT', 3306)),
        'user': os.getenv('NODE1_USER'),
        'password': os.getenv('NODE1_PASSWORD'),
        'database': os.getenv('NODE1_DB')
    },
    'Partition 2 (Node 2)': {
        'host': os.getenv('NODE2_HOST'),
        'port': int(os.getenv('NODE2_PORT', 3306)),
        'user': os.getenv('NODE2_USER'),
        'password': os.getenv('NODE2_PASSWORD'),
        'database': os.getenv('NODE2_DB')
    }
}

def fix_node(node_name, config):
    """Fix AUTO_INCREMENT on a single node"""
    print(f"\n{'='*60}")
    print(f"Fixing {node_name}")
    print(f"{'='*60}")
    
    try:
        # Connect to database
        conn = mysql.connector.connect(**config)
        cursor = conn.cursor()
        
        # Check current structure
        print("1. Checking current table structure...")
        cursor.execute("DESCRIBE users")
        columns = cursor.fetchall()
        
        id_column = [col for col in columns if col[0] == 'id']
        if id_column:
            extra = id_column[0][5] if len(id_column[0]) > 5 else ''
            if 'auto_increment' in extra.lower():
                print(f"   ✓ AUTO_INCREMENT already set on {node_name}")
                cursor.close()
                conn.close()
                return True
            else:
                print(f"   ✗ AUTO_INCREMENT NOT set on {node_name}")
        
        # Apply fix
        print("2. Applying AUTO_INCREMENT fix...")
        try:
            # Try with PRIMARY KEY first
            cursor.execute("ALTER TABLE users MODIFY COLUMN id INT AUTO_INCREMENT PRIMARY KEY")
        except mysql.connector.Error as e:
            if '1068' in str(e):  # Multiple primary key error
                print("   → Primary key already exists, trying without PRIMARY KEY clause...")
                cursor.execute("ALTER TABLE users MODIFY COLUMN id INT AUTO_INCREMENT")
            else:
                raise
        conn.commit()
        print("   ✓ ALTER TABLE executed successfully")
        
        # Verify fix
        print("3. Verifying fix...")
        cursor.execute("SHOW CREATE TABLE users")
        create_table = cursor.fetchone()[1]
        if 'AUTO_INCREMENT' in create_table:
            print(f"   ✓ {node_name} fixed successfully!")
        else:
            print(f"   ✗ Verification failed on {node_name}")
            
        # Test insert
        print("4. Testing auto-increment with test insert...")
        cursor.execute("""
            INSERT INTO users (firstname, lastname, city, country, createdAt, updatedAt) 
            VALUES ('TestFix', 'User', 'TestCity', 'USA', NOW(), NOW())
        """)
        conn.commit()
        
        test_id = cursor.lastrowid
        print(f"   ✓ Test insert successful! Auto-generated ID: {test_id}")
        
        # Clean up test data
        cursor.execute(f"DELETE FROM users WHERE id = {test_id}")
        conn.commit()
        print("   ✓ Test data cleaned up")
        
        cursor.close()
        conn.close()
        
        print(f"✓ {node_name} is ready!")
        return True
        
    except mysql.connector.Error as err:
        print(f"✗ Error on {node_name}: {err}")
        return False
    except Exception as e:
        print(f"✗ Unexpected error on {node_name}: {e}")
        return False

def main():
    print("="*60)
    print("DATABASE SCHEMA FIX - AUTO_INCREMENT")
    print("="*60)
    print("\nThis script will fix the AUTO_INCREMENT issue on all 3 nodes")
    print("that's preventing Case #3 from working.\n")
    
    results = {}
    
    for node_name, config in nodes.items():
        # Check if config is complete
        if not all([config['host'], config['user'], config['password'], config['database']]):
            print(f"\n⚠ Skipping {node_name} - incomplete configuration")
            results[node_name] = False
            continue
            
        results[node_name] = fix_node(node_name, config)
    
    # Summary
    print("\n" + "="*60)
    print("SUMMARY")
    print("="*60)
    
    success_count = sum(1 for success in results.values() if success)
    total_count = len(results)
    
    for node_name, success in results.items():
        status = "✓ FIXED" if success else "✗ FAILED"
        print(f"{node_name}: {status}")
    
    print(f"\nTotal: {success_count}/{total_count} nodes fixed successfully")
    
    if success_count == total_count:
        print("\n🎉 All nodes fixed! You can now run Case #3.")
        print("   Restart your application if it's running, then test again.")
    else:
        print("\n⚠ Some nodes failed. Check error messages above.")
        print("   You may need to run the SQL commands manually.")

if __name__ == "__main__":
    main()
