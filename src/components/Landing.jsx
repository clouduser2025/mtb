import React, { useState, useEffect } from 'react';
import { Container, Button, Table, Form, Alert, Modal, Row, Col, Dropdown, ButtonGroup, Navbar, Nav } from 'react-bootstrap';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faUserCog, faUserPlus, faUsers, faSignInAlt, faShoppingCart, faExchangeAlt, faChartLine, faDollarSign, faDashboard, faCog, faHandsHelping, faQuestionCircle } from '@fortawesome/free-solid-svg-icons'; 
import './css/landing.css';

const Landing = () => {
  const [users, setUsers] = useState([]); 
  const [showRegisterModal, setShowRegisterModal] = useState(false);
  const [showUsers, setShowUsers] = useState(false);
  const [selectedUsers, setSelectedUsers] = useState([]);
  const [message, setMessage] = useState({ text: "", type: "" });
  const [openTrades, setOpenTrades] = useState([]);  
  const [showTradesDashboard, setShowTradesDashboard] = useState(false);
  const [formStep, setFormStep] = useState(1);
  const [activeTradeId, setActiveTradeId] = useState(null);

  const [formData, setFormData] = useState({
    username: "",
    password: "",
    broker: "Angel",  // Default to Angel, can be "Shoonya"
    api_key: "",
    totp_token: "",
    default_quantity: 1,
    tradingsymbol: "",
    symboltoken: "3045",  // Default for Angel, can adjust for Shoonya
    exchange: "NSE",
    strike_price: 100,  // Default from examples
    buy_type: "Fixed",  // Default: Fixed Price Buy
    buy_threshold: 110, // Default: ₹110
    previous_close: 100, // Default for Percentage Buy
    producttype: "INTRADAY",  // Default for Angel, can be "C", "I", etc. for Shoonya
    stop_loss_type: "Fixed", // Default: Fixed Stop-Loss
    stop_loss_value: 5,      // Default: 5 points
    points_condition: 0,     // Default: No adjustment
  });

  const fetchUsers = async () => {
    try {
      const response = await fetch("https://mtb-8ra9.onrender.com/api/get_users");
      const data = await response.json();
      setUsers(data.users || []);
    } catch (error) {
      console.error("Error fetching users:", error);
      setMessage({ text: "Failed to fetch users", type: "danger" });
    }
  };

  const fetchOpenPositions = async () => {
    try {
      const response = await fetch("https://mtb-8ra9.onrender.com/api/get_trades");
      const data = await response.json();
      setOpenTrades(data.trades || []);
    } catch (error) {
      console.error("Error fetching open positions:", error);
      setMessage({ text: "Failed to fetch open positions", type: "danger" });
    }
  };

  const handleRegisterSubmit = async (e) => {
    e.preventDefault();
    try {
      const response = await fetch("https://mtb-8ra9.onrender.com/api/register_user", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: formData.username,
          password: formData.password,
          broker: formData.broker,
          api_key: formData.api_key,
          totp_token: formData.totp_token,
          default_quantity: parseInt(formData.default_quantity || 1, 10),
        }),
      });
      const data = await response.json();
      if (response.ok) {
        setMessage({ text: `User ${formData.username} registered successfully (${formData.broker})!`, type: "success" });
        fetchUsers();
        setFormData({ ...formData, username: "", password: "", api_key: "", totp_token: "" });
        setShowRegisterModal(false);
      } else {
        setMessage({ text: data.detail || "Registration failed", type: "danger" });
      }
    } catch (error) {
      console.error("Error registering user:", error);
      setMessage({ text: `Server error registering ${formData.broker} user. Try again later.`, type: "danger" });
    }
  };

  const handleDeleteUser = async (username) => {
    try {
      const response = await fetch(`https://mtb-8ra9.onrender.com/api/delete_user/${username}`, { method: "DELETE" });
      const data = await response.json();
      if (response.ok) {
        setUsers(users.filter(user => user.username !== username));
        setMessage({ text: "User deleted successfully!", type: "success" });
      } else {
        setMessage({ text: data.detail || "Failed to delete user", type: "danger" });
      }
    } catch (error) {
      console.error("Error deleting user:", error);
      setMessage({ text: "Server error. Try again later.", type: "danger" });
    }
  };

  const handleInitiateTrade = async () => {
    if (!selectedUsers.length) {
      setMessage({ text: "Please select at least one user.", type: "warning" });
      return;
    }

    try {
      for (const username of selectedUsers) {
        const user = users.find(u => u.username === username);
        if (!user) continue;

        // Adjust producttype based on broker (e.g., "INTRADAY" for Angel, "I" for Shoonya MIS)
        const adjustedProductType = user.broker === "Shoonya" && formData.producttype === "INTRADAY" ? "I" : formData.producttype;

        const response = await fetch("https://mtb-8ra9.onrender.com/api/initiate_buy_trade", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            username,
            tradingsymbol: formData.tradingsymbol,
            symboltoken: formData.symboltoken,
            exchange: formData.exchange,
            strike_price: formData.strike_price,
            buy_type: formData.buy_type,
            buy_threshold: formData.buy_threshold,
            previous_close: formData.buy_type === "Percentage" ? formData.previous_close : undefined,
            producttype: adjustedProductType,
            stop_loss_type: formData.stop_loss_type,
            stop_loss_value: formData.stop_loss_value,
            points_condition: formData.points_condition,
          }),
        });

        const data = await response.json();
        if (response.ok) {
          setMessage({ text: `Buy trade initiated for ${username} (${user.broker})! Position ID: ${data.position_id}`, type: "success" });
          setActiveTradeId(data.position_id);
          fetchOpenPositions();
        } else {
          setMessage({ text: `Failed for ${username} (${user.broker}): ${data.detail}`, type: "danger" });
        }
      }
    } catch (error) {
      console.error("Error initiating trade:", error);
      setMessage({ text: "Server error initiating trade.", type: "danger" });
    }
    setFormStep(1);
    setSelectedUsers([]);
  };

  const handleUpdateConditions = async () => {
    if (!activeTradeId || !selectedUsers.length) {
      setMessage({ text: "No active trade or users selected for update.", type: "warning" });
      return;
    }

    try {
      for (const username of selectedUsers) {
        const user = users.find(u => u.username === username);
        if (!user) continue;

        const response = await fetch("https://mtb-8ra9.onrender.com/api/update_trade_conditions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            username,
            position_id: activeTradeId,
            stop_loss_type: formData.stop_loss_type,
            stop_loss_value: formData.stop_loss_value,
            points_condition: formData.points_condition,
          }),
        });

        const data = await response.json();
        if (response.ok) {
          setMessage({ text: `Conditions updated for ${username} (${user.broker})!`, type: "success" });
        } else {
          setMessage({ text: `Failed to update for ${username} (${user.broker}): ${data.detail}`, type: "danger" });
        }
      }
    } catch (error) {
      console.error("Error updating conditions:", error);
      setMessage({ text: "Server error updating conditions.", type: "danger" });
    }
  };

  const UserActionsDropdown = ({ setShowRegisterModal, setShowUsers, showUsers }) => (
    <Dropdown as={ButtonGroup}>
      <Dropdown.Toggle variant="primary" id="dropdown-basic" className="user-actions-dropdown">
        <FontAwesomeIcon icon={faUserCog} />
      </Dropdown.Toggle>
      <Dropdown.Menu>
        <Dropdown.Item onClick={() => setShowRegisterModal(true)}>
          <FontAwesomeIcon icon={faUserPlus} className="me-2" /> Register
        </Dropdown.Item>
        <Dropdown.Item onClick={() => { setShowUsers(!showUsers); fetchUsers(); }}>
          <FontAwesomeIcon icon={faUsers} className="me-2" /> View Users
        </Dropdown.Item>
        <Dropdown.Item onClick={() => window.open('https://www.angelone.in/login/?redirectUrl=account', '_blank')}>
          <FontAwesomeIcon icon={faSignInAlt} className="me-2" /> Angel Login
        </Dropdown.Item>
        <Dropdown.Item onClick={() => window.open('https://www.shoonya.com/login', '_blank')}>
          <FontAwesomeIcon icon={faSignInAlt} className="me-2" /> Shoonya Login
        </Dropdown.Item>
      </Dropdown.Menu>
    </Dropdown>
  );

  useEffect(() => {
    fetchUsers();
    fetchOpenPositions();
  }, []);

  return (
    <div className="shoonya-container">
      {/* Top Navbar (Similar to Shoonya) */}
      <Navbar bg="light" expand="lg" className="shoonya-navbar">
        <Navbar.Brand className="shoonya-logo">
          <span className="shoonya-icon">Sh</span> Trading Platform
          <span className="by-finvasia">by Finvasia</span>
        </Navbar.Brand>
        <Navbar.Toggle aria-controls="basic-navbar-nav" />
        <Navbar.Collapse id="basic-navbar-nav">
          <Nav className="ms-auto">
            <Nav.Link href="#home" className="shoonya-nav-link">
              <Button variant="outline-secondary" className="me-2">Financial Ledger List</Button>
            </Nav.Link>
            <Nav.Link href="#portfolio" className="shoonya-nav-link">
              <Button variant="outline-secondary" className="me-2">Portfolio</Button>
            </Nav.Link>
            <Nav.Link href="#holdings" className="shoonya-nav-link">
              <Button variant="outline-secondary" className="me-2">Holdings</Button>
            </Nav.Link>
            <Nav.Link href="#trade-confirmation" className="shoonya-nav-link">
              <Button variant="outline-secondary" className="me-2">Trade Confirmation</Button>
            </Nav.Link>
            <Nav.Link href="#pnl-report" className="shoonya-nav-link">
              <Button variant="outline-secondary" className="me-2">P&L Report</Button>
            </Nav.Link>
            <Nav.Link href="#contract-note" className="shoonya-nav-link">
              <Button variant="outline-secondary">Contract Note</Button>
            </Nav.Link>
            <Dropdown align="end" className="ms-2">
              <Dropdown.Toggle variant="light" id="user-dropdown">
                <img src="https://via.placeholder.com/30" alt="User" className="rounded-circle me-2" />
                Welcome, Amresh Kumar Gupta <FontAwesomeIcon icon={faCaretDown} />
              </Dropdown.Toggle>
              <Dropdown.Menu>
                <Dropdown.Item href="#profile">Profile</Dropdown.Item>
                <Dropdown.Item href="#logout">Logout</Dropdown.Item>
              </Dropdown.Menu>
            </Dropdown>
          </Nav>
        </Navbar.Collapse>
      </Navbar>

      {/* Sidebar (Similar to Shoonya) */}
      <div className="shoonya-sidebar">
        <Nav className="flex-column">
          <Nav.Link href="#dashboard" className="shoonya-sidebar-link">
            <FontAwesomeIcon icon={faDashboard} className="me-2" /> Dashboard
          </Nav.Link>
          <Nav.Link href="#manage-account" className="shoonya-sidebar-link active">
            <FontAwesomeIcon icon={faCog} className="me-2" /> Manage Account
          </Nav.Link>
          <Nav.Link href="#services" className="shoonya-sidebar-link">
            <FontAwesomeIcon icon={faHandsHelping} className="me-2" /> Services
          </Nav.Link>
          <Nav.Link href="#faqs" className="shoonya-sidebar-link">
            <FontAwesomeIcon icon={faQuestionCircle} className="me-2" /> FAQs
          </Nav.Link>
        </Nav>
      </div>

      {/* Main Content Area */}
      <Container className="shoonya-content mt-4">
        {message.text && <Alert variant={message.type} className="mt-3 mb-3">{message.text}</Alert>}

        <Row className="justify-content-end mb-3" style={{ position: "absolute", top: "10px", right: "20px", zIndex: "1000" }}>
          <Col xs="auto">
            <UserActionsDropdown setShowRegisterModal={setShowRegisterModal} setShowUsers={setShowUsers} showUsers={showUsers} />
          </Col>
        </Row>

        {showUsers && (
          <div className="shoonya-section mb-5">
            <h3 className="text-center mb-4 text-primary"><FontAwesomeIcon icon={faUsers} className="me-2" /> Registered Users</h3>
            <Table striped bordered hover className="shoonya-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Username</th>
                  <th>Broker</th>
                  <th>Default Quantity</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {users.length > 0 ? (
                  users.map((user, index) => (
                    <tr key={index}>
                      <td>{index + 1}</td>
                      <td>{user.username}</td>
                      <td>{user.broker}</td>
                      <td>{user.default_quantity}</td>
                      <td><Button variant="danger" size="sm" onClick={() => handleDeleteUser(user.username)}>Delete</Button></td>
                    </tr>
                  ))
                ) : (
                  <tr><td colSpan="5" className="text-muted text-center">No registered users found.</td></tr>
                )}
              </tbody>
            </Table>
          </div>
        )}

        {showTradesDashboard && (
          <div className="shoonya-section mt-5 p-4 shadow-lg rounded bg-white">
            <h3 className="text-center mb-4 text-dark fw-bold"><FontAwesomeIcon icon={faExchangeAlt} className="me-2 text-primary" /> Active Trades</h3>
            <Table striped bordered hover className="shoonya-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Username</th>
                  <th>Symbol</th>
                  <th>Entry Price</th>
                  <th>Buy Threshold</th>
                  <th>Stop-Loss Type</th>
                  <th>Stop-Loss Value</th>
                  <th>Position</th>
                  <th>Broker</th>
                </tr>
              </thead>
              <tbody>
                {openTrades.length > 0 ? (
                  openTrades.map((trade, index) => (
                    <tr key={index}>
                      <td>{index + 1}</td>
                      <td>{trade.username}</td>
                      <td>{trade.symbol}</td>
                      <td>₹{trade.entry_price}</td>
                      <td>₹{trade.buy_threshold}</td>
                      <td>{trade.stop_loss_type}</td>
                      <td>{trade.stop_loss_value}</td>
                      <td><span className="badge bg-success">Buy</span></td>
                      <td>{users.find(u => u.username === trade.username)?.broker || "Unknown"}</td>
                    </tr>
                  ))
                ) : (
                  <tr><td colSpan="9" className="text-muted text-center">No active trades found.</td></tr>
                )}
              </tbody>
            </Table>
          </div>
        )}

        <Row className="justify-content-center mb-3">
          <Col xs="auto"><Button variant="outline-primary" onClick={() => window.open('https://www.angelone.in/trade/markets/equity/overview', '_blank')}>Market Overview</Button></Col>
          <Col xs="auto"><Button variant="outline-primary" onClick={() => window.open('https://www.angelone.in/trade/indices/indian', '_blank')}>Indices</Button></Col>
          <Col xs="auto"><Button variant="outline-primary" onClick={() => window.open('https://www.angelone.in/trade/watchlist/chart', '_blank')}>Chart</Button></Col>
          <Col xs="auto"><Button variant="outline-primary" onClick={() => window.open('https://www.angelone.in/trade/watchlist/option-chain', '_blank')}>Option Chain</Button></Col>
          <Col xs="auto"><Button variant="outline-primary" onClick={() => { setShowTradesDashboard(!showTradesDashboard); fetchOpenPositions(); }}>Trades Dashboard</Button></Col>
        </Row>

        <div className="shoonya-section mt-4 p-3 border rounded shadow-sm">
          {/* Step 1: Select Users */}
          {formStep === 1 && (
            <>
              <h4 className="text-primary"><FontAwesomeIcon icon={faUsers} /> Step 1: Select Users (1 to 3)</h4>
              <Form>
                <Row className="mb-3">
                  <Col>
                    {users.map((user, index) => (
                      <Form.Check
                        key={index}
                        type="checkbox"
                        label={user.username}
                        checked={selectedUsers.includes(user.username)}
                        onChange={(e) => {
                          if (e.target.checked) {
                            if (selectedUsers.length < 3) setSelectedUsers([...selectedUsers, user.username]);
                            else alert("⚠ You can only select up to 3 users.");
                          } else {
                            setSelectedUsers(selectedUsers.filter(u => u !== user.username));
                          }
                        }}
                      />
                    ))}
                  </Col>
                </Row>
                <Button variant="primary" onClick={() => { if (selectedUsers.length) setFormStep(2); else alert("Select at least 1 user."); }}>Next</Button>
              </Form>
            </>
          )}

          {/* Step 2: Select Symbol and Strike Price */}
          {formStep === 2 && (
            <>
              <h4 className="text-primary"><FontAwesomeIcon icon={faChartLine} /> Step 2: Select Symbol and Strike Price</h4>
              <Form>
                <Row className="mb-3">
                  <Col md={4}><Form.Group><Form.Label>Trading Symbol</Form.Label><Form.Control type="text" value={formData.tradingsymbol} onChange={(e) => setFormData({ ...formData, tradingsymbol: e.target.value })} required /></Form.Group></Col>
                  <Col md={4}><Form.Group><Form.Label>Symbol Token</Form.Label><Form.Control type="text" value={formData.symboltoken} onChange={(e) => setFormData({ ...formData, symboltoken: e.target.value })} required /></Form.Group></Col>
                  <Col md={4}><Form.Group><Form.Label>Strike Price</Form.Label><Form.Control type="number" value={formData.strike_price} onChange={(e) => setFormData({ ...formData, strike_price: parseFloat(e.target.value) || 0 })} required /></Form.Group></Col>
                </Row>
                <Button variant="primary" onClick={() => setFormStep(3)}>Next</Button>
                <Button variant="secondary" onClick={() => { setFormStep(1); setSelectedUsers([]); }} className="ms-2">Back</Button>
              </Form>
            </>
          )}

          {/* Step 3: Stop-Loss Condition */}
          {formStep === 3 && (
            <>
              <h4 className="text-primary"><FontAwesomeIcon icon={faDollarSign} /> Step 3: Set Stop-Loss Condition</h4>
              <Form>
                <Row className="mb-3">
                  <Col md={4}><Form.Group><Form.Label>Stop-Loss Type</Form.Label><Form.Select value={formData.stop_loss_type} onChange={(e) => setFormData({ ...formData, stop_loss_type: e.target.value })}><option value="Fixed">Fixed</option><option value="Percentage">Percentage</option><option value="Points">Points</option></Form.Select></Form.Group></Col>
                  <Col md={4}><Form.Group><Form.Label>Stop-Loss Value</Form.Label><Form.Control type="number" value={formData.stop_loss_value} onChange={(e) => setFormData({ ...formData, stop_loss_value: parseFloat(e.target.value) || 0 })} required /></Form.Group></Col>
                  <Col md={4}><Form.Group><Form.Label>Points Condition</Form.Label><Form.Control type="number" value={formData.points_condition} onChange={(e) => setFormData({ ...formData, points_condition: parseFloat(e.target.value) || 0 })} /></Form.Group></Col>
                </Row>
                <Button variant="primary" onClick={() => setFormStep(4)}>Next</Button>
                <Button variant="secondary" onClick={() => setFormStep(2)} className="ms-2">Back</Button>
              </Form>
            </>
          )}

          {/* Step 4: Buy Condition */}
          {formStep === 4 && (
            <>
              <h4 className="text-primary"><FontAwesomeIcon icon={faShoppingCart} /> Step 4: Set Buy Condition</h4>
              <Form>
                <Row className="mb-3">
                  <Col md={4}>
                    <Form.Group><Form.Label>Buy Condition Type</Form.Label>
                      <Form.Select value={formData.buy_type} onChange={(e) => setFormData({ ...formData, buy_type: e.target.value })}>
                        <option value="Fixed">Fixed Price (e.g., ₹110)</option>
                        <option value="Percentage">Percentage Increase (e.g., 5%)</option>
                      </Form.Select>
                    </Form.Group>
                  </Col>
                  <Col md={4}><Form.Group><Form.Label>{formData.buy_type === "Fixed" ? "Buy Threshold" : "Buy % Increase"}</Form.Label><Form.Control type="number" value={formData.buy_threshold} onChange={(e) => setFormData({ ...formData, buy_threshold: parseFloat(e.target.value) || 0 })} required /></Form.Group></Col>
                  {formData.buy_type === "Percentage" && (
                    <Col md={4}><Form.Group><Form.Label>Previous Close</Form.Label><Form.Control type="number" value={formData.previous_close} onChange={(e) => setFormData({ ...formData, previous_close: parseFloat(e.target.value) || 0 })} required /></Form.Group></Col>
                  )}
                  <Col md={4}><Form.Group><Form.Label>Product Type</Form.Label><Form.Select value={formData.producttype} onChange={(e) => setFormData({ ...formData, producttype: e.target.value })}>
                    {formData.broker === "Angel" ? (
                      <>
                        <option value="INTRADAY">Intraday</option>
                        <option value="DELIVERY">Delivery</option>
                      </>
                    ) : (
                      <>
                        <option value="C">CNC (Cash and Carry)</option>
                        <option value="I">MIS (Intraday)</option>
                        <option value="M">NRML (Normal)</option>
                        <option value="B">Bracket Order</option>
                        <option value="H">Cover Order</option>
                      </>
                    )}
                  </Form.Select></Form.Group></Col>
                </Row>
                <Button variant="primary" onClick={() => setFormStep(5)}>Next</Button>
                <Button variant="secondary" onClick={() => setFormStep(3)} className="ms-2">Back</Button>
              </Form>
            </>
          )}

          {/* Step 5: Sell Condition and Execute */}
          {formStep === 5 && (
            <>
              <h4 className="text-success"><FontAwesomeIcon icon={faExchangeAlt} /> Step 5: Confirm Sell Condition and Execute Trade</h4>
              <Form>
                <Row className="mb-3">
                  <Col>
                    <p><strong>Selected Users:</strong> {selectedUsers.join(", ")}</p>
                    <p><strong>Symbol:</strong> {formData.tradingsymbol}</p>
                    <p><strong>Strike Price:</strong> ₹{formData.strike_price}</p>
                    <p><strong>Buy Condition:</strong> {formData.buy_type === "Fixed" ? `≥ ₹${formData.buy_threshold}` : `≥ ₹${(formData.previous_close * (1 + formData.buy_threshold / 100)).toFixed(2)} (${formData.buy_threshold}%)`}</p>
                    <p><strong>Sell Condition (Stop-Loss):</strong> {formData.stop_loss_type} at {formData.stop_loss_value} {formData.stop_loss_type === "Percentage" ? "%" : ""} (Points: {formData.points_condition})</p>
                    <p><strong>Product Type:</strong> {formData.producttype}</p>
                    <p><strong>Broker:</strong> {formData.broker}</p>
                  </Col>
                </Row>
                <Button variant="success" onClick={handleInitiateTrade}>Execute Trade</Button>
                <Button variant="secondary" onClick={() => setFormStep(4)} className="ms-2">Back</Button>
              </Form>
            </>
          )}
        </div>

        {/* Optional: Update Conditions */}
        {activeTradeId && (
          <div className="shoonya-section mt-4 p-3 border rounded shadow-sm">
            <h4 className="text-warning"><FontAwesomeIcon icon={faExchangeAlt} /> Update Sell Conditions</h4>
            <Form>
              <Row className="mb-3">
                <Col md={4}><Form.Group><Form.Label>Stop-Loss Type</Form.Label><Form.Select value={formData.stop_loss_type} onChange={(e) => setFormData({ ...formData, stop_loss_type: e.target.value })}><option value="Fixed">Fixed</option><option value="Percentage">Percentage</option><option value="Points">Points</option></Form.Select></Form.Group></Col>
                <Col md={4}><Form.Group><Form.Label>Stop-Loss Value</Form.Label><Form.Control type="number" value={formData.stop_loss_value} onChange={(e) => setFormData({ ...formData, stop_loss_value: parseFloat(e.target.value) || 0 })} /></Form.Group></Col>
                <Col md={4}><Form.Group><Form.Label>Points Condition</Form.Label><Form.Control type="number" value={formData.points_condition} onChange={(e) => setFormData({ ...formData, points_condition: parseFloat(e.target.value) || 0 })} /></Form.Group></Col>
              </Row>
              <Button variant="warning" onClick={handleUpdateConditions}>Update Conditions</Button>
            </Form>
          </div>
        )}

        <Modal show={showRegisterModal} onHide={() => setShowRegisterModal(false)} className="shoonya-modal">
          <Modal.Header closeButton><Modal.Title>Register User</Modal.Title></Modal.Header>
          <Modal.Body>
            {message.text && <Alert variant={message.type}>{message.text}</Alert>}
            <Form onSubmit={handleRegisterSubmit}>
              <Form.Group><Form.Label>Username</Form.Label><Form.Control type="text" value={formData.username} onChange={(e) => setFormData({ ...formData, username: e.target.value })} required /></Form.Group>
              <Form.Group><Form.Label>Password</Form.Label><Form.Control type="password" value={formData.password} onChange={(e) => setFormData({ ...formData, password: e.target.value })} required /></Form.Group>
              <Form.Group><Form.Label>Broker</Form.Label><Form.Select value={formData.broker} onChange={(e) => setFormData({ ...formData, broker: e.target.value })}>
                <option value="Angel">Angel</option>
                <option value="Shoonya">Shoonya</option>
              </Form.Select></Form.Group>
              <Form.Group><Form.Label>API Key</Form.Label><Form.Control type="text" value={formData.api_key} onChange={(e) => setFormData({ ...formData, api_key: e.target.value })} required /></Form.Group>
              <Form.Group><Form.Label>TOTP Token</Form.Label><Form.Control type="text" value={formData.totp_token} onChange={(e) => setFormData({ ...formData, totp_token: e.target.value })} required /></Form.Group>
              <Form.Group><Form.Label>Default Quantity</Form.Label><Form.Control type="number" value={formData.default_quantity} onChange={(e) => setFormData({ ...formData, default_quantity: e.target.value })} required /></Form.Group>
              <Button variant="primary" type="submit" className="mt-3">Register</Button>
            </Form>
          </Modal.Body>
        </Modal>
      </Container>
    </div>
  );
};

export default Landing;